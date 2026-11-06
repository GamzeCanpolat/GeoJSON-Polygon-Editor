"""Repeatable local HTTP/worker benchmark; all user data stays untouched."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import Event, Thread
import time
from urllib.request import Request, urlopen

import psutil

# Support direct invocation even when an environment disables editable .pth hooks.
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

from app.core.config import BACKEND_DIR, Settings
from app.domain.streaming_geojson import stream_collection
from app.workers.import_worker import ProgressReader


def canonical(value):
    return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(",",":")).encode('utf-8')


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--mib',type=int,default=105)
    parser.add_argument('--report',type=Path,default=BACKEND_DIR/'var/benchmarks/large-import.json')
    args=parser.parse_args()
    with TemporaryDirectory(prefix='geojson-large-benchmark-') as folder:
        root=Path(folder)
        source=root/'large.geojson'
        expected=hashlib.sha256()
        metadata={'custom':{'source':'sentetik ölçüm','preserve':[True,None,3]},'category_catalog':[{'name':'Kullanılmayan','subcategories':['Boş alt']}]}
        count=0
        with source.open('wb') as output:
            output.write((json.dumps({'type':'FeatureCollection',**metadata},ensure_ascii=False)[:-1]+',"features":[').encode())
            while output.tell()<args.mib*1024**2:
                item={'type':'Feature','id':count%17,'properties':{'name':'Alan','payload':'x'*1024,'typed':[True,None,1.5]},
                      'geometry':{'type':'Point','coordinates':[37+(count%10000)*.00001,39,123]},'foreign':{'keep':True}}
                encoded=canonical(item)
                if count: output.write(b',')
                output.write(encoded)
                expected.update(encoded)
                count+=1
            output.write(b']}')
        env=os.environ.copy()
        env.update(GEOJSON_DATABASE_PATH=str(root/'projects.db'),GEOJSON_IMPORT_MAX_BYTES=str(max(128,args.mib+8)*1024**2),
                   GEOJSON_IMPORT_DISK_QUOTA_BYTES=str(2*1024**3),GEOJSON_IMPORT_BATCH_SIZE='500',GEOJSON_IMPORT_BATCH_BYTES=str(4*1024**2))
        subprocess.run([sys.executable,'-m','alembic','-c',str(BACKEND_DIR/'alembic.ini'),'upgrade','head'],env=env,cwd=BACKEND_DIR,check=True,capture_output=True)
        with socket.socket() as probe:
            probe.bind(('127.0.0.1',0)); port=probe.getsockname()[1]
        base=f'http://127.0.0.1:{port}'
        def api(path,data=None):
            request=Request(base+path,data=json.dumps(data or {}).encode() if data is not None else None,
                            headers={'Content-Type':'application/json'})
            with urlopen(request,timeout=30) as response: return json.load(response)
        logs=(root/'server.log').open('w+')
        server=subprocess.Popen([sys.executable,'-m','uvicorn','app.main:app','--host','127.0.0.1','--port',str(port)],env=env,cwd=BACKEND_DIR,stdout=logs,stderr=subprocess.STDOUT)
        stop=Event(); peaks={'server':0,'workerTree':0}; workers=[]
        def monitor():
            while not stop.wait(.025):
                try: peaks['server']=max(peaks['server'],psutil.Process(server.pid).memory_info().rss)
                except psutil.Error: pass
                for worker in workers:
                    try:
                        process=psutil.Process(worker.pid)
                        rss=process.memory_info().rss+sum(child.memory_info().rss for child in process.children(recursive=True))
                        peaks['workerTree']=max(peaks['workerTree'],rss)
                    except psutil.Error: pass
        watcher=Thread(target=monitor,daemon=True); watcher.start()
        worker=None
        worker_log=(root/'worker.log').open('w+')
        try:
            for _ in range(100):
                try: api('/api/v1/health'); break
                except OSError:
                    if server.poll() is not None: raise RuntimeError('API startup failed')
                    time.sleep(.1)
            else: raise RuntimeError('API startup timeout')
            baseline=psutil.Process(server.pid).memory_info().rss
            workspace=api('/api/v1/workspaces',{})
            job=api(f"/api/v1/workspaces/{workspace['id']}/imports",{})
            boundary='geojson-benchmark-boundary'
            header=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.geojson"\r\nContent-Type: application/geo+json\r\n\r\n').encode()
            trailer=f'\r\n--{boundary}--\r\n'.encode()
            connection=http.client.HTTPConnection('127.0.0.1',port,timeout=120)
            started=time.perf_counter()
            connection.putrequest('POST',f"/api/v1/workspaces/{workspace['id']}/imports?jobId={job['id']}")
            connection.putheader('Content-Type',f'multipart/form-data; boundary={boundary}')
            connection.putheader('Content-Length',str(len(header)+source.stat().st_size+len(trailer)))
            connection.endheaders(); connection.send(header)
            with source.open('rb') as input_file:
                while chunk:=input_file.read(64*1024): connection.send(chunk)
            connection.send(trailer)
            response=connection.getresponse(); uploaded=json.loads(response.read()); connection.close()
            if response.status!=202: raise RuntimeError(uploaded)
            upload_seconds=time.perf_counter()-started
            started=time.perf_counter()
            worker=subprocess.Popen([sys.executable,'-m','app.workers.import_worker','--once'],env=env,cwd=BACKEND_DIR,stdout=worker_log,stderr=subprocess.STDOUT)
            workers.append(worker)
            while worker.poll() is None:
                if time.perf_counter()-started>600: raise RuntimeError('Benchmark worker timeout')
                time.sleep(.1)
            import_seconds=time.perf_counter()-started
            result=api(f"/api/v1/jobs/{job['id']}")
            if result['status']!='completed': raise RuntimeError(result)
            started=time.perf_counter()
            active=api(f"/api/v1/jobs/{job['id']}/activate",{})
            activation_seconds=time.perf_counter()-started
            exported=root/'export.geojson'
            started=time.perf_counter()
            with urlopen(base+f"/api/v1/workspaces/{workspace['id']}/export",timeout=120) as response, exported.open('wb') as output:
                while chunk:=response.read(64*1024): output.write(chunk)
            export_seconds=time.perf_counter()-started
            actual=hashlib.sha256(); exported_count=0; exported_metadata=None
            settings=Settings(_env_file=None,database_path=root/'projects.db')
            with exported.open('rb') as input_file:
                reader=ProgressReader(input_file,64*1024,lambda amount:None)
                for kind,value,_size in stream_collection(reader,settings):
                    if kind=='feature': actual.update(canonical(value)); exported_count+=1
                    else: exported_metadata=value
            assert expected.hexdigest()==actual.hexdigest() and exported_count==count
            assert exported_metadata['custom']==metadata['custom'] and exported_metadata['category_catalog']==metadata['category_catalog']
            assert active['dataset']['count']==count and active['dataset']['revision']==0
            report={'inputBytes':source.stat().st_size,'inputMiB':round(source.stat().st_size/1024**2,3),'features':count,
                    'uploadSeconds':round(upload_seconds,3),'importWorkerSeconds':round(import_seconds,3),
                    'activationSeconds':round(activation_seconds,3),'exportSeconds':round(export_seconds,3),
                    'apiBaselineRssMiB':round(baseline/1024**2,3),'apiPeakRssMiB':round(peaks['server']/1024**2,3),
                    'processingChildPeakRssMiB':round(result['peakRssBytes']/1024**2,3),
                    'workerTreePeakRssMiB':round(peaks['workerTree']/1024**2,3),
                    'semanticFeatureSha256':actual.hexdigest(),'allFeaturesMatch':True,'metadataMatches':True,
                    'environment':'macOS local loopback HTTP; temporary SQLite; synthetic Point/Z features; 25 ms RSS sampling'}
            args.report.parent.mkdir(parents=True,exist_ok=True)
            args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
            print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
        finally:
            stop.set(); watcher.join(2)
            for process in [worker,server]:
                if process is not None and process.poll() is None:
                    process.terminate()
                    try: process.wait(timeout=10)
                    except subprocess.TimeoutExpired: process.kill(); process.wait()
            if sys.exc_info()[0]:
                logs.flush(); logs.seek(0); worker_log.flush(); worker_log.seek(0)
                print(logs.read()[-3000:]+worker_log.read()[-3000:],file=sys.stderr)
            logs.close(); worker_log.close()


if __name__=='__main__': main()
