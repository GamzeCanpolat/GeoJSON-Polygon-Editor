from io import BytesIO
import json
import pytest

from app.domain.geojson import prepare_feature
from app.domain.streaming_geojson import stream_collection, StreamFormatError
from app.services.geometry_validation import strict_json_loads, GeometryValidationError

VALUES = [9007199254740991, 9007199254740992, 9007199254740993, 9007199254740995, -9007199254740993]

def raw_feature(value):
    return f'{{"type":"Feature","id":{value},"properties":{{"exact":{value},"nested":[{value},true,null,"{value}",1.25]}},"geometry":{{"type":"Point","coordinates":[29,41,7]}}}}'

@pytest.mark.parametrize('value', VALUES)
def test_integer_tokens_remain_exact_in_http_and_stream_parsers(value, settings):
    source = raw_feature(value)
    parsed = strict_json_loads(source.encode())
    stream = list(stream_collection(BytesIO(('{"type":"FeatureCollection","features":['+source+']}').encode()), settings))
    assert parsed['id'] == value and type(parsed['id']) is int
    assert stream[0][1] == parsed
    assert parsed['properties']['nested'] == [value, True, None, str(value), 1.25]
    assert str(value) in json.dumps(prepare_feature(parsed))

@pytest.mark.parametrize('token', ['9007199254740993.0', '9007199254740993e0', '-9007199254740993e0'])
def test_integer_exponent_tokens_are_not_first_rounded_to_float(token, settings):
    expected = -9007199254740993 if token.startswith('-') else 9007199254740993
    source = raw_feature(token)
    assert strict_json_loads(source.encode())['id'] == expected
    assert list(stream_collection(BytesIO(source.encode()), settings))[0][1]['id'] == expected

@pytest.mark.parametrize('token', ['1.123456789012345678901', '1e-999'])
def test_unsupported_fractional_precision_is_explicitly_rejected(token, settings):
    source = raw_feature(token)
    with pytest.raises(GeometryValidationError, match='hassasiyet'):
        strict_json_loads(source.encode())
    with pytest.raises(StreamFormatError, match='hassasiyet'):
        list(stream_collection(BytesIO(source.encode()), settings))

def test_normal_decimals_and_string_id_remain_unchanged():
    value = strict_json_loads(b'{"id":"9007199254740993","values":[1.25,-2.5,1e-7,null,true]}')
    assert value == {'id':'9007199254740993','values':[1.25,-2.5,1e-7,None,True]}

def test_reserved_prototype_keys_are_rejected_before_import_activation(settings):
    for source in ['{"type":"FeatureCollection","__proto__":{},"features":[]}', raw_feature(1).replace('"exact":1','"__proto__":1')]:
        with pytest.raises(GeometryValidationError, match='__proto__'):
            strict_json_loads(source.encode())
        with pytest.raises(StreamFormatError, match='__proto__'):
            list(stream_collection(BytesIO(source.encode()),settings))

@pytest.mark.parametrize('value', [9007199254740993, 10**400])
def test_unrepresentable_z_coordinate_fails_before_shapely_or_float_conversion(value):
    feature = json.loads(raw_feature(1))
    feature['geometry']['coordinates'][2] = value
    with pytest.raises(ValueError, match='hassasiyet'):
        prepare_feature(feature)

def test_http_rejection_is_422_and_preserves_workspace(migrated_database, client):
    workspace = client.post('/api/v1/workspaces',json={}).json()
    expected={'expectedDatasetId':workspace['activeDatasetId'],'expectedGenerationId':workspace['generationId'],'expectedRevision':0}
    prefix=json.dumps(expected)[:-1]
    payload=prefix+',"feature":'+raw_feature('1.123456789012345678901')+'}'
    response=client.post(f"/api/v1/workspaces/{workspace['id']}/mutations",content=payload,headers={'Content-Type':'application/json'})
    assert response.status_code==422 and 'hassasiyet' in response.text
    assert client.get(f"/api/v1/workspaces/{workspace['id']}").json()['dataset']==workspace['dataset']
