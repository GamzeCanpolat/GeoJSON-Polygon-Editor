"""Create dataset feature project and category models

Revision ID: 0001_data_models
Revises: None
Create Date: 2026-11-05 18:17:45.658096
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '0001_data_models'
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Frozen stage-3 schema; migration deliberately does not import ORM models.
    op.create_table('datasets',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('generation_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('revision', sa.Integer(), server_default='0', nullable=False),
    sa.Column('count', sa.Integer(), server_default='0', nullable=False),
    sa.Column('vertices', sa.Integer(), server_default='0', nullable=False),
    sa.Column('bounds', sa.JSON(none_as_null=True), nullable=True),
    sa.Column('source_bytes', sa.Integer(), server_default='0', nullable=False),
    sa.Column('next_ordinal', sa.Integer(), server_default='0', nullable=False),
    sa.Column('status', sa.String(length=16), server_default='draft', nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint("status IN ('draft', 'staging', 'snapshot')", name=op.f('ck_datasets_status_values')),
    sa.CheckConstraint('count >= 0', name=op.f('ck_datasets_count_nonnegative')),
    sa.CheckConstraint('next_ordinal >= 0 AND next_ordinal <= 9007199254740991', name=op.f('ck_datasets_ordinal_range')),
    sa.CheckConstraint('revision >= 0', name=op.f('ck_datasets_revision_nonnegative')),
    sa.CheckConstraint('source_bytes >= 0', name=op.f('ck_datasets_source_bytes_nonnegative')),
    sa.CheckConstraint('vertices >= 0', name=op.f('ck_datasets_vertices_nonnegative')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_datasets'))
    )
    with op.batch_alter_table('datasets', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_datasets_generation_id'), ['generation_id'], unique=False)

    op.create_table('categories',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('dataset_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('normalized_name', sa.String(), nullable=False),
    sa.ForeignKeyConstraint(['dataset_id'], ['datasets.id'], name=op.f('fk_categories_dataset_id_datasets'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_categories')),
    sa.UniqueConstraint('dataset_id', 'normalized_name', name=op.f('uq_categories_dataset_id'))
    )
    with op.batch_alter_table('categories', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_categories_dataset_id'), ['dataset_id'], unique=False)

    op.create_table('features',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('dataset_id', sa.String(length=36), nullable=False),
    sa.Column('ordinal', sa.Integer(), nullable=False),
    sa.Column('feature_json', sa.JSON(), nullable=False),
    sa.Column('geometry_type', sa.String(), nullable=False),
    sa.Column('label', sa.String(), nullable=False),
    sa.Column('vertices', sa.Integer(), nullable=False),
    sa.Column('bounds', sa.JSON(none_as_null=True), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default='0', nullable=False),
    sa.CheckConstraint('is_deleted IN (0, 1)', name=op.f('ck_features_deleted_boolean')),
    sa.CheckConstraint('ordinal >= 0 AND ordinal <= 9007199254740991', name=op.f('ck_features_ordinal_range')),
    sa.CheckConstraint('vertices >= 0', name=op.f('ck_features_vertices_nonnegative')),
    sa.ForeignKeyConstraint(['dataset_id'], ['datasets.id'], name=op.f('fk_features_dataset_id_datasets'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_features')),
    sa.UniqueConstraint('dataset_id', 'ordinal', name=op.f('uq_features_dataset_id')),
    sqlite_autoincrement=True
    )
    with op.batch_alter_table('features', schema=None) as batch_op:
        batch_op.create_index('ix_features_dataset_live_ordinal', ['dataset_id', 'is_deleted', 'ordinal'], unique=False)

    op.create_table('projects',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('saved_dataset_id', sa.String(length=36), nullable=True),
    sa.Column('version', sa.Integer(), server_default='1', nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint('version >= 1', name=op.f('ck_projects_version_positive')),
    sa.ForeignKeyConstraint(['saved_dataset_id'], ['datasets.id'], name=op.f('fk_projects_saved_dataset_id_datasets'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_projects'))
    )
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_projects_saved_dataset_id'), ['saved_dataset_id'], unique=False)

    op.create_table('subcategories',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('category_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('normalized_name', sa.String(), nullable=False),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], name=op.f('fk_subcategories_category_id_categories'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_subcategories')),
    sa.UniqueConstraint('category_id', 'normalized_name', name=op.f('uq_subcategories_category_id'))
    )
    with op.batch_alter_table('subcategories', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_subcategories_category_id'), ['category_id'], unique=False)

    op.create_table('workspaces',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=True),
    sa.Column('active_dataset_id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['active_dataset_id'], ['datasets.id'], name=op.f('fk_workspaces_active_dataset_id_datasets'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_workspaces_project_id_projects'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_workspaces'))
    )
    with op.batch_alter_table('workspaces', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_workspaces_active_dataset_id'), ['active_dataset_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_workspaces_project_id'), ['project_id'], unique=False)



def downgrade() -> None:
    # Drop dependants before referenced datasets; foreign_keys remains enabled.
    with op.batch_alter_table('workspaces', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_workspaces_project_id'))
        batch_op.drop_index(batch_op.f('ix_workspaces_active_dataset_id'))

    op.drop_table('workspaces')
    with op.batch_alter_table('subcategories', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_subcategories_category_id'))

    op.drop_table('subcategories')
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_projects_saved_dataset_id'))

    op.drop_table('projects')
    with op.batch_alter_table('features', schema=None) as batch_op:
        batch_op.drop_index('ix_features_dataset_live_ordinal')

    op.drop_table('features')
    with op.batch_alter_table('categories', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_categories_dataset_id'))

    op.drop_table('categories')
    with op.batch_alter_table('datasets', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_datasets_generation_id'))

    op.drop_table('datasets')
