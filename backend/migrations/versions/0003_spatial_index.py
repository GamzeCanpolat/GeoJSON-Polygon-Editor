"""Transactional R-Tree backfill and feature synchronization triggers.

Revision ID: 0003_spatial_index
Revises: 0002_import_jobs
"""
from alembic import op

revision = "0003_spatial_index"
down_revision = "0002_import_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE VIRTUAL TABLE feature_rtree USING rtree(id,min_x,max_x,min_y,max_y,+dataset_id)")
    op.execute("""INSERT INTO feature_rtree(id,min_x,max_x,min_y,max_y,dataset_id)
        SELECT id,json_extract(bounds,'$[0]'),json_extract(bounds,'$[2]'),
               json_extract(bounds,'$[1]'),json_extract(bounds,'$[3]'),dataset_id
        FROM features WHERE is_deleted=0 AND bounds IS NOT NULL
          AND json_type(bounds)='array' AND json_array_length(bounds)=4""")
    op.execute("""CREATE TRIGGER feature_rtree_insert AFTER INSERT ON features
        WHEN NEW.is_deleted=0 AND NEW.bounds IS NOT NULL
          AND json_type(NEW.bounds)='array' AND json_array_length(NEW.bounds)=4
        BEGIN
            INSERT INTO feature_rtree(id,min_x,max_x,min_y,max_y,dataset_id)
            VALUES(NEW.id,json_extract(NEW.bounds,'$[0]'),json_extract(NEW.bounds,'$[2]'),
                   json_extract(NEW.bounds,'$[1]'),json_extract(NEW.bounds,'$[3]'),NEW.dataset_id);
        END""")
    op.execute("""CREATE TRIGGER feature_rtree_update
        AFTER UPDATE OF id,dataset_id,bounds,is_deleted ON features
        BEGIN
            DELETE FROM feature_rtree WHERE id=OLD.id;
            INSERT INTO feature_rtree(id,min_x,max_x,min_y,max_y,dataset_id)
                SELECT NEW.id,json_extract(NEW.bounds,'$[0]'),json_extract(NEW.bounds,'$[2]'),
                       json_extract(NEW.bounds,'$[1]'),json_extract(NEW.bounds,'$[3]'),NEW.dataset_id
                WHERE NEW.is_deleted=0 AND NEW.bounds IS NOT NULL
                  AND json_type(NEW.bounds)='array' AND json_array_length(NEW.bounds)=4;
        END""")
    op.execute("""CREATE TRIGGER feature_rtree_delete AFTER DELETE ON features
        BEGIN DELETE FROM feature_rtree WHERE id=OLD.id; END""")


def downgrade() -> None:
    op.execute("DROP TRIGGER feature_rtree_delete")
    op.execute("DROP TRIGGER feature_rtree_update")
    op.execute("DROP TRIGGER feature_rtree_insert")
    op.execute("DROP TABLE feature_rtree")
