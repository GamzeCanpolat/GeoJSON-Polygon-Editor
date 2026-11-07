"""HTTP-facing workspace scope; existing aggregate services own the actual data."""
import json

from app.db.models import Workspace, utc_now
from app.domain.geojson import describe_feature, prepare_feature
from app.services.datasets import DatasetService
from app.services.errors import NotFoundError, RevisionConflictError
from app.services.projects import ProjectService


class RepositoryInputError(ValueError):
    pass


class RepositoryLimitError(ValueError):
    pass


class RepositoryService:
    def __init__(self,session,settings):
        self.session,self.settings=session,settings
        self.projects=ProjectService(session)
        self.datasets=DatasetService(session)

    def context(self,workspace_id):
        return self.projects.get_workspace(workspace_id)

    def _write_workspace(self,workspace_id,expected_dataset_id,expected_generation_id,expected_revision):
        workspace=self.projects._workspace(workspace_id,lock=True)
        self.projects._source(workspace,str(expected_dataset_id),str(expected_generation_id),expected_revision)
        return workspace

    def _feature(self,value):
        stack=[(value,1)]; count=0
        while stack:
            item,depth=stack.pop(); count+=1
            if depth>self.settings.repository_max_depth or count>self.settings.repository_max_nodes:
                raise RepositoryLimitError('Feature iç içelik/işlem sınırı aşıldı.')
            children=item.values() if isinstance(item,dict) else item if isinstance(item,list) else ()
            stack.extend((child,depth+1) for child in children)
        # LocalEngine.mutate cleans all derived bbox fields, even for inserts and
        # property-only changes. Keep the underlying storage service unchanged.
        try:
            if len(json.dumps(value,ensure_ascii=False,allow_nan=False).encode('utf-8'))>self.settings.repository_max_feature_bytes:
                raise RepositoryLimitError('Feature boyut sınırı aşıldı.')
            clean=prepare_feature(value,remove_bbox=True)
            if describe_feature(clean,0)[2]>self.settings.repository_max_feature_vertices:
                raise RepositoryLimitError('Feature koordinat sayısı sınırı aşıldı.')
            return clean
        except (ValueError,TypeError,OverflowError,RecursionError) as error:
            if isinstance(error,RepositoryLimitError): raise
            raise RepositoryInputError(str(error)[:256]) from error

    def mutate(self,workspace_id,*,id=None,feature,expected_dataset_id,expected_generation_id,expected_revision):
        clean=self._feature(feature) if feature is not None else None
        with self.session.begin_nested():
            workspace=self._write_workspace(workspace_id,expected_dataset_id,expected_generation_id,expected_revision)
            dataset_id=workspace.active_dataset_id
            try:
                if id is None:
                    if clean is None: raise RepositoryInputError('Silme işlemi için bir şekil kimliği gerekli.')
                    result=self.datasets.add_feature(dataset_id,clean,expected_revision=expected_revision)
                elif clean is None:
                    result=self.datasets.delete_feature(dataset_id,id,expected_revision=expected_revision)
                else:
                    dataset=self.datasets.get_dataset(dataset_id)
                    row=self.datasets._row(dataset,id,include_deleted=True)
                    method=self.datasets.restore_feature if row.is_deleted else self.datasets.update_feature
                    result=method(dataset_id,id,clean,expected_revision=expected_revision)
            except (NotFoundError,RevisionConflictError): raise
            except ValueError as error: raise RepositoryInputError(str(error)) from error
            workspace.updated_at=utc_now()
            self.session.flush()
            return result

    def add_category(self,workspace_id,name,parent=None,**expected):
        with self.session.begin_nested():
            workspace=self._write_workspace(workspace_id,**expected)
            try:
                result=self.datasets.add_category(workspace.active_dataset_id,name,parent,expected_revision=expected['expected_revision'])
            except (NotFoundError,RevisionConflictError): raise
            except ValueError as error: raise RepositoryInputError(str(error)) from error
            workspace.updated_at=utc_now()
            self.session.flush()
            return result

    def create_empty(self,workspace_id,**expected):
        with self.session.begin_nested():
            workspace=self._write_workspace(workspace_id,**expected)
            dataset=self.datasets.create_dataset()
            workspace.active_dataset_id,workspace.project_id,workspace.updated_at=dataset.id,None,utc_now()
            self.session.flush()
            # Preserve unreferenced previous drafts here; deleting potentially
            # huge user data must not turn this endpoint into a long transaction.
            return self.context(workspace_id)
