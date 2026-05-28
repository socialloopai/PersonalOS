import {TableData, TableRulesExtensionData, sqlValue} from 'teenybase'
import {baseFields, createdTrigger, updatedTrigger} from 'teenybase/scaffolds/fields'

const permissive: TableRulesExtensionData = {
    name: 'rules',
    listRule: 'true', viewRule: 'true', createRule: 'true', updateRule: 'true', deleteRule: 'true',
}

export const soulItemsTable: TableData = {
    name: 'soul_items',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'type', type: 'text', sqlType: 'text', notNull: true, default: sqlValue('habit')},
        {name: 'name', type: 'text', sqlType: 'text', notNull: true},
        {name: 'becoming_connection', type: 'text', sqlType: 'text'},
        {name: 'frequency', type: 'text', sqlType: 'text'},
        {name: 'time_of_day', type: 'text', sqlType: 'text'},
        {name: 'project_id', type: 'relation', sqlType: 'text', foreignKey: {table: 'projects', column: 'id'}},
        {name: 'minimum_version', type: 'text', sqlType: 'text'},
        {name: 'status', type: 'text', sqlType: 'text', notNull: true, default: sqlValue('active')},
        {name: 'streak', type: 'number', sqlType: 'integer', notNull: true, default: sqlValue(0)},
        {name: 'best_streak', type: 'number', sqlType: 'integer', notNull: true, default: sqlValue(0)},
    ],
    indexes: [{fields: 'owner_id'}, {fields: 'status'}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

export const soulLogsTable: TableData = {
    name: 'soul_logs',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'soul_item_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'soul_items', column: 'id'}},
        {name: 'completed_at', type: 'date', sqlType: 'text', notNull: true},
    ],
    indexes: [{fields: 'soul_item_id, completed_at', unique: true}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

export const soulItemStepsTable: TableData = {
    name: 'soul_item_steps',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'soul_item_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'soul_items', column: 'id'}},
        {name: 'order_index', type: 'number', sqlType: 'integer'},
        {name: 'name', type: 'text', sqlType: 'text', notNull: true},
    ],
    indexes: [{fields: 'soul_item_id'}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

export const soulStepLogsTable: TableData = {
    name: 'soul_step_logs',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'soul_item_step_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'soul_item_steps', column: 'id'}},
        {name: 'date', type: 'date', sqlType: 'text', notNull: true},
    ],
    indexes: [{fields: 'soul_item_step_id, date', unique: true}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}
