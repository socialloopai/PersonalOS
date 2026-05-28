import {TableData, TableRulesExtensionData, sqlValue} from 'teenybase'
import {baseFields, createdTrigger, updatedTrigger} from 'teenybase/scaffolds/fields'

const permissive: TableRulesExtensionData = {
    name: 'rules',
    listRule: 'true', viewRule: 'true', createRule: 'true', updateRule: 'true', deleteRule: 'true',
}

export const businessEntitiesTable: TableData = {
    name: 'business_entities',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'name', type: 'text', sqlType: 'text', notNull: true},
        {name: 'ein', type: 'text', sqlType: 'text'},
        {name: 'state', type: 'text', sqlType: 'text'},
        {name: 'formed_on', type: 'date', sqlType: 'text'},
        {name: 'notes', type: 'text', sqlType: 'text'},
    ],
    indexes: [{fields: 'owner_id'}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

export const legalCasesTable: TableData = {
    name: 'legal_cases',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'person', type: 'text', sqlType: 'text', notNull: true, default: sqlValue('self')},
        {name: 'category', type: 'text', sqlType: 'text', notNull: true},
        {name: 'case_type', type: 'text', sqlType: 'text'},
        {name: 'case_name', type: 'text', sqlType: 'text', notNull: true},
        {name: 'receipt_number', type: 'text', sqlType: 'text'},
        {name: 'filing_date', type: 'date', sqlType: 'text'},
        {name: 'attorney', type: 'text', sqlType: 'text'},
        {name: 'status', type: 'text', sqlType: 'text'},
        {name: 'status_detail', type: 'text', sqlType: 'text'},
        {name: 'status_last_checked', type: 'date', sqlType: 'text'},
        {name: 'next_action', type: 'text', sqlType: 'text'},
        {name: 'next_action_date', type: 'date', sqlType: 'text'},
        {name: 'estimated_completion', type: 'text', sqlType: 'text'},
        {name: 'priority', type: 'text', sqlType: 'text', default: sqlValue('medium')},
        {name: 'notes', type: 'text', sqlType: 'text'},
        {name: 'milestones', type: 'json', sqlType: 'json'},
    ],
    indexes: [{fields: 'owner_id'}, {fields: 'person'}, {fields: 'status'}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

export const taxYearNotesTable: TableData = {
    name: 'tax_year_notes',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'tax_year', type: 'number', sqlType: 'integer', notNull: true},
        {name: 'status', type: 'text', sqlType: 'text'},
        {name: 'notes', type: 'text', sqlType: 'text'},
    ],
    indexes: [{fields: 'owner_id'}, {fields: 'tax_year'}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}
