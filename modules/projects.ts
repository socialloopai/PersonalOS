import {TableData, TableRulesExtensionData, sql, sqlValue} from 'teenybase'
import {baseFields, createdTrigger, updatedTrigger} from 'teenybase/scaffolds/fields'

const permissive: TableRulesExtensionData = {
    name: 'rules',
    listRule: 'true', viewRule: 'true', createRule: 'true', updateRule: 'true', deleteRule: 'true',
}

// completed_at maintenance trigger (two halves, mirrors the original tasks_completed_at PL/pgSQL)
const setCompletedAtTrigger = {
    name: 'tasks_set_completed_at_on_done',
    seq: 'AFTER' as const,
    event: 'UPDATE' as const,
    updateOf: ['status'],
    body: sql`UPDATE tasks SET completed_at = CURRENT_TIMESTAMP WHERE id = NEW.id AND NEW.status = 'done' AND OLD.status != 'done'`,
}
const clearCompletedAtTrigger = {
    name: 'tasks_clear_completed_at_on_undone',
    seq: 'AFTER' as const,
    event: 'UPDATE' as const,
    updateOf: ['status'],
    body: sql`UPDATE tasks SET completed_at = NULL WHERE id = NEW.id AND NEW.status != 'done' AND OLD.status = 'done'`,
}

// Recompute projects.be_score whenever child tasks change. Three trigger variants
// for INSERT / UPDATE / DELETE — SQLite triggers can only reference NEW (INSERT/UPDATE)
// or OLD (UPDATE/DELETE) depending on the event, so we need a body per trigger.
const beRecomputeFor = (idRef: string) => sql`
UPDATE projects SET be_score = MAX(0, MIN(10, COALESCE(
    (SELECT AVG(impact) * 10.0 / 5 FROM tasks
     WHERE project_id = projects.id
       AND status NOT IN ('done', 'cancelled')
       AND impact IS NOT NULL), 0
))) WHERE id = ${idRef}
`

const beRecomputeInsert = {
    name: 'tasks_be_recompute_insert',
    seq: 'AFTER' as const,
    event: 'INSERT' as const,
    body: beRecomputeFor('NEW.project_id'),
}
const beRecomputeUpdate = {
    name: 'tasks_be_recompute_update',
    seq: 'AFTER' as const,
    event: 'UPDATE' as const,
    body: beRecomputeFor('NEW.project_id'),
}
const beRecomputeDelete = {
    name: 'tasks_be_recompute_delete',
    seq: 'AFTER' as const,
    event: 'DELETE' as const,
    body: beRecomputeFor('OLD.project_id'),
}

export const projectsTable: TableData = {
    name: 'projects',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'parent_id', type: 'relation', sqlType: 'text', foreignKey: {table: 'projects', column: 'id'}},
        {name: 'name', type: 'text', sqlType: 'text', notNull: true},
        {name: 'description', type: 'text', sqlType: 'text'},
        {name: 'becoming_statement', type: 'text', sqlType: 'text'},
        {name: 'category', type: 'text', sqlType: 'text'},
        {name: 'status', type: 'text', sqlType: 'text', notNull: true, default: sqlValue('active')},
        {name: 'priority', type: 'text', sqlType: 'text', default: sqlValue('medium')},
        {name: 'color', type: 'text', sqlType: 'text'},
        {name: 'notes', type: 'text', sqlType: 'text'},
        {name: 'start_date', type: 'date', sqlType: 'text'},
        {name: 'due_date', type: 'date', sqlType: 'text'},
        {name: 'be_score', type: 'number', sqlType: 'real', default: sqlValue(0)},
    ],
    indexes: [{fields: 'owner_id'}, {fields: 'status'}, {fields: 'parent_id'}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

export const tasksTable: TableData = {
    name: 'tasks',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'project_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'projects', column: 'id'}},
        {name: 'name', type: 'text', sqlType: 'text', notNull: true},
        {name: 'description', type: 'text', sqlType: 'text'},
        {name: 'status', type: 'text', sqlType: 'text', notNull: true, default: sqlValue('todo')},
        {name: 'priority', type: 'text', sqlType: 'text', default: sqlValue('medium')},
        {name: 'impact', type: 'number', sqlType: 'integer'},
        {name: 'due_date', type: 'date', sqlType: 'text'},
        {name: 'completed_at', type: 'date', sqlType: 'text'},
    ],
    indexes: [{fields: 'owner_id'}, {fields: 'project_id'}, {fields: 'status'}],
    triggers: [
        createdTrigger, updatedTrigger,
        setCompletedAtTrigger, clearCompletedAtTrigger,
        beRecomputeInsert, beRecomputeUpdate, beRecomputeDelete,
    ],
    extensions: [permissive],
}

export const projectSnapshotsTable: TableData = {
    name: 'project_snapshots',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'project_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'projects', column: 'id'}},
        {name: 'be_score', type: 'number', sqlType: 'real'},
        {name: 'do_score', type: 'number', sqlType: 'real'},
        {name: 'become_score', type: 'number', sqlType: 'real'},
        {name: 'reason', type: 'text', sqlType: 'text'},
    ],
    indexes: [{fields: 'project_id'}, {fields: 'owner_id'}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}
