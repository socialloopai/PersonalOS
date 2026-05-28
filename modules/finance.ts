import {TableData, TableRulesExtensionData, sqlValue} from 'teenybase'
import {baseFields, createdTrigger, updatedTrigger} from 'teenybase/scaffolds/fields'

const permissive: TableRulesExtensionData = {
    name: 'rules',
    listRule: 'true', viewRule: 'true', createRule: 'true', updateRule: 'true', deleteRule: 'true',
}

export const plaidItemsTable: TableData = {
    name: 'plaid_items',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'institution_id', type: 'text', sqlType: 'text'},
        {name: 'institution_name', type: 'text', sqlType: 'text'},
        {name: 'access_token', type: 'text', sqlType: 'text'},
        {name: 'cursor', type: 'text', sqlType: 'text'},
        {name: 'last_synced_at', type: 'date', sqlType: 'text'},
    ],
    indexes: [{fields: 'owner_id'}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

export const bankAccountsTable: TableData = {
    name: 'bank_accounts',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'plaid_item_id', type: 'relation', sqlType: 'text', foreignKey: {table: 'plaid_items', column: 'id'}},
        {name: 'plaid_account_id', type: 'text', sqlType: 'text'},
        {name: 'name', type: 'text', sqlType: 'text', notNull: true},
        {name: 'custom_name', type: 'text', sqlType: 'text'},
        {name: 'type', type: 'text', sqlType: 'text'},
        {name: 'subtype', type: 'text', sqlType: 'text'},
        {name: 'mask', type: 'text', sqlType: 'text'},
        {name: 'balance_current', type: 'number', sqlType: 'real'},
        {name: 'balance_available', type: 'number', sqlType: 'real'},
        {name: 'payment_due_date', type: 'date', sqlType: 'text'},
        {name: 'minimum_payment_amount', type: 'number', sqlType: 'real'},
        {name: 'last_statement_balance', type: 'number', sqlType: 'real'},
        {name: 'last_payment_amount', type: 'number', sqlType: 'real'},
        {name: 'last_payment_date', type: 'date', sqlType: 'text'},
    ],
    indexes: [{fields: 'owner_id'}, {fields: 'plaid_item_id'}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

export const transactionsTable: TableData = {
    name: 'transactions',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'bank_account_id', type: 'relation', sqlType: 'text', foreignKey: {table: 'bank_accounts', column: 'id'}},
        {name: 'plaid_transaction_id', type: 'text', sqlType: 'text', unique: true},
        {name: 'date', type: 'date', sqlType: 'text', notNull: true},
        {name: 'amount', type: 'number', sqlType: 'real', notNull: true},
        {name: 'name', type: 'text', sqlType: 'text'},
        {name: 'merchant_name', type: 'text', sqlType: 'text'},
        {name: 'description', type: 'text', sqlType: 'text'},
        {name: 'ai_category', type: 'text', sqlType: 'text'},
        {name: 'pending', type: 'bool', sqlType: 'boolean', default: sqlValue(false)},
        {name: 'source', type: 'text', sqlType: 'text', default: sqlValue('plaid')},
        {name: 'statement_id', type: 'text', sqlType: 'text'},
        {name: 'dedup_hash', type: 'text', sqlType: 'text'},
    ],
    indexes: [
        {fields: 'owner_id'},
        {fields: 'bank_account_id'},
        {fields: 'date'},
        {fields: 'dedup_hash'},
    ],
    fullTextSearch: {
        fields: ['name', 'merchant_name', 'description', 'ai_category'],
        tokenize: 'trigram',
    },
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

export const liabilitiesTable: TableData = {
    name: 'liabilities',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'name', type: 'text', sqlType: 'text', notNull: true},
        {name: 'amount', type: 'number', sqlType: 'real', notNull: true},
        {name: 'status', type: 'text', sqlType: 'text', default: sqlValue('unpaid')},
        {name: 'due_date', type: 'date', sqlType: 'text'},
        {name: 'paid_at', type: 'date', sqlType: 'text'},
        {name: 'notes', type: 'text', sqlType: 'text'},
    ],
    indexes: [{fields: 'owner_id'}, {fields: 'status'}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}
