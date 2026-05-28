import {TableData, TableRulesExtensionData, sqlValue} from 'teenybase'
import {baseFields, createdTrigger, updatedTrigger} from 'teenybase/scaffolds/fields'

const permissive: TableRulesExtensionData = {
    name: 'rules',
    listRule: 'true', viewRule: 'true', createRule: 'true', updateRule: 'true', deleteRule: 'true',
}

export const reflectionsTable: TableData = {
    name: 'reflections',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'content', type: 'editor', sqlType: 'text', notNull: true},
    ],
    indexes: [{fields: 'owner_id'}, {fields: 'created'}],
    fullTextSearch: {fields: ['content'], tokenize: 'porter'},
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

// Daily BECOME snapshot. Unique per (owner_id, date) so re-runs upsert.
// reflection_ids is stored as a JSON array of strings (SQLite has no array type).
export const snapshotsTable: TableData = {
    name: 'snapshots',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'date', type: 'date', sqlType: 'text', notNull: true},
        {name: 'schema_version', type: 'number', sqlType: 'integer', notNull: true, default: sqlValue(2)},
        {name: 'reflection_ids', type: 'json', sqlType: 'json'},
        {name: 'agg_be', type: 'number', sqlType: 'real'},
        {name: 'agg_do', type: 'number', sqlType: 'real'},
        {name: 'agg_become', type: 'number', sqlType: 'real'},
        {name: 'diagnosis', type: 'text', sqlType: 'text'},
        {name: 'resonance', type: 'number', sqlType: 'real'},
        // Per-domain scores (denormalized for fast dashboard reads, matches original)
        {name: 'sleep_be', type: 'number', sqlType: 'real'},
        {name: 'sleep_do', type: 'number', sqlType: 'real'},
        {name: 'sleep_become', type: 'number', sqlType: 'real'},
        {name: 'body_be', type: 'number', sqlType: 'real'},
        {name: 'body_do', type: 'number', sqlType: 'real'},
        {name: 'body_become', type: 'number', sqlType: 'real'},
        {name: 'food_be', type: 'number', sqlType: 'real'},
        {name: 'food_do', type: 'number', sqlType: 'real'},
        {name: 'food_become', type: 'number', sqlType: 'real'},
        {name: 'money_be', type: 'number', sqlType: 'real'},
        {name: 'money_do', type: 'number', sqlType: 'real'},
        {name: 'money_become', type: 'number', sqlType: 'real'},
        {name: 'tasks_be', type: 'number', sqlType: 'real'},
        {name: 'tasks_do', type: 'number', sqlType: 'real'},
        {name: 'tasks_become', type: 'number', sqlType: 'real'},
        {name: 'reflection_be', type: 'number', sqlType: 'real'},
        {name: 'reflection_do', type: 'number', sqlType: 'real'},
        {name: 'reflection_become', type: 'number', sqlType: 'real'},
        {name: 'data_flags', type: 'json', sqlType: 'json'},
        {name: 'delta_be', type: 'number', sqlType: 'real'},
        {name: 'delta_do', type: 'number', sqlType: 'real'},
        {name: 'delta_become', type: 'number', sqlType: 'real'},
        {name: 'delta_identity_component', type: 'number', sqlType: 'real'},
        {name: 'delta_execution_component', type: 'number', sqlType: 'real'},
        {name: 'delta_compared_to', type: 'date', sqlType: 'text'},
        {name: 'domains', type: 'json', sqlType: 'json'},
        {name: 'reflection_characterization', type: 'text', sqlType: 'text'},
        {name: 'insight', type: 'text', sqlType: 'text'},
        {name: 'data_snapshot', type: 'json', sqlType: 'json'},
        {name: 'synthesized_at', type: 'date', sqlType: 'text'},
        {name: 'synthesized_by', type: 'text', sqlType: 'text'},
    ],
    indexes: [{fields: 'owner_id, date', unique: true}, {fields: 'date'}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

export const snapshotRunsTable: TableData = {
    name: 'snapshot_runs',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'snapshot_id', type: 'relation', sqlType: 'text', foreignKey: {table: 'snapshots', column: 'id'}},
        {name: 'date', type: 'date', sqlType: 'text', notNull: true},
        {name: 'schema_version', type: 'number', sqlType: 'integer', notNull: true, default: sqlValue(2)},
        {name: 'resulted_in_change', type: 'bool', sqlType: 'boolean', notNull: true, default: sqlValue(true)},
        {name: 'notes', type: 'text', sqlType: 'text'},
    ],
    indexes: [{fields: 'snapshot_id'}, {fields: 'owner_id'}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

export const debriefsTable: TableData = {
    name: 'debriefs',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'date', type: 'date', sqlType: 'text', notNull: true},
        {name: 'schema_version', type: 'number', sqlType: 'integer', notNull: true, default: sqlValue(2)},
        {name: 'prior_snapshot_id', type: 'relation', sqlType: 'text', foreignKey: {table: 'snapshots', column: 'id'}},
        {name: 'prior_snapshot_date', type: 'date', sqlType: 'text'},
        {name: 'horizon_read', type: 'text', sqlType: 'text'},
        {name: 'month_read', type: 'text', sqlType: 'text'},
        {name: 'week_read', type: 'text', sqlType: 'text'},
        {name: 'yesterday_read', type: 'text', sqlType: 'text'},
        {name: 'today_terrain', type: 'text', sqlType: 'text'},
        {name: 'orientation', type: 'text', sqlType: 'text', notNull: true},
        {name: 'full_text', type: 'text', sqlType: 'text', notNull: true},
        {name: 'horizon_snapshot', type: 'json', sqlType: 'json'},
        {name: 'calendar_snapshot', type: 'json', sqlType: 'json'},
        {name: 'tasks_snapshot', type: 'json', sqlType: 'json'},
        {name: 'reflections_snapshot', type: 'json', sqlType: 'json'},
        {name: 'snapshots_snapshot', type: 'json', sqlType: 'json'},
        {name: 'generated_at', type: 'date', sqlType: 'text'},
        {name: 'generated_by', type: 'text', sqlType: 'text'},
        {name: 'triggered_by', type: 'text', sqlType: 'text'},
    ],
    indexes: [{fields: 'owner_id, date', unique: true}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}
