import json

from sqlalchemy import Text, cast, func, select

from app.db.models import Category, Dataset, Feature, Subcategory
from app.db.session import Database
from app.services.catalog import CatalogStore
from app.services.jobs import ImportErrorResponse
from app.services.projects import ProjectService


class GeoJsonExport:
    """Hold one SQLite read snapshot until streaming finishes or disconnects."""
    def __init__(self, settings, workspace_id):
        self.database = Database(settings)
        self.session = self.database.sessions()
        self.closed = False
        try:
            self.workspace = ProjectService(self.session).get_workspace(workspace_id)
            dataset = self.session.get(Dataset,self.workspace.active_dataset_id)
            count = self.session.scalar(select(func.count(Category.id)).where(Category.dataset_id == dataset.id))
            count += self.session.scalar(select(func.count(Subcategory.id)).join(Category).where(Category.dataset_id == dataset.id))
            if count > settings.import_max_categories:
                raise ImportErrorResponse("Export kategori sınırı aşıldı.",413)
            self.metadata = {key:value for key,value in dataset.metadata_json.items() if key not in ("type","features","category_catalog")}
            self.catalog = [group.model_dump() for group in CatalogStore(self.session,dataset.id).list()]
            self.rows = self.session.execute(select(cast(Feature.feature_json,Text)).where(
                Feature.dataset_id == dataset.id,Feature.is_deleted.is_(False)).order_by(Feature.ordinal).execution_options(yield_per=1))
        except BaseException:
            self.close()
            raise

    def close(self):
        if not self.closed:
            self.closed = True
            self.session.close()
            self.database.dispose()

    def chunks(self):
        try:
            envelope = {"type":"FeatureCollection",**self.metadata,"category_catalog":self.catalog}
            prefix = json.dumps(envelope,ensure_ascii=False,allow_nan=False,separators=(",",":"))[:-1]
            yield (prefix+',"features":[').encode("utf-8")
            first = True
            for (source,) in self.rows:
                if not first: yield b","
                first = False
                yield source.encode("utf-8")
            yield b"]}"
        finally:
            self.close()
