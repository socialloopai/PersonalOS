import {TableData, TableRulesExtensionData, sqlValue} from 'teenybase'
import {baseFields, createdTrigger, updatedTrigger} from 'teenybase/scaffolds/fields'

const permissive: TableRulesExtensionData = {
    name: 'rules',
    listRule: 'true', viewRule: 'true', createRule: 'true', updateRule: 'true', deleteRule: 'true',
}

// Unified document store. Polymorphic via nullable FKs to entity / legal_case / bank_account.
// category enum: 'identity' | 'entity' | 'tax' | 'statement' | 'other'
// Statement-importer fields (processing_*) are folded in here so we don't need a separate jobs table.
export const documentsTable: TableData = {
    name: 'documents',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'category', type: 'text', sqlType: 'text', notNull: true, default: sqlValue('other')},
        {name: 'label', type: 'text', sqlType: 'text'},
        {name: 'file', type: 'file', sqlType: 'text'},
        {name: 'file_name', type: 'text', sqlType: 'text'},
        {name: 'file_size_bytes', type: 'number', sqlType: 'integer'},
        // Polymorphic owner refs (each nullable, only one populated per category)
        {name: 'entity_id', type: 'relation', sqlType: 'text', foreignKey: {table: 'business_entities', column: 'id'}},
        {name: 'legal_case_id', type: 'relation', sqlType: 'text', foreignKey: {table: 'legal_cases', column: 'id'}},
        {name: 'bank_account_id', type: 'relation', sqlType: 'text', foreignKey: {table: 'bank_accounts', column: 'id'}},
        {name: 'tax_year', type: 'number', sqlType: 'integer'},
        {name: 'statement_date', type: 'date', sqlType: 'text'},
        // Statement processing job fields (only used when category='statement')
        {name: 'processing_status', type: 'text', sqlType: 'text'},
        {name: 'processing_found_count', type: 'number', sqlType: 'integer', default: sqlValue(0)},
        {name: 'processing_inserted_count', type: 'number', sqlType: 'integer', default: sqlValue(0)},
        {name: 'processing_skipped_count', type: 'number', sqlType: 'integer', default: sqlValue(0)},
        {name: 'processing_error', type: 'text', sqlType: 'text'},
    ],
    indexes: [
        {fields: 'owner_id'},
        {fields: 'category'},
        {fields: 'entity_id'},
        {fields: 'legal_case_id'},
        {fields: 'bank_account_id'},
        {fields: 'tax_year'},
        {fields: 'processing_status'},
    ],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}
