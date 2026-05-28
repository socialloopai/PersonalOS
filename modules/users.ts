import {TableData, TableAuthExtensionData, TableRulesExtensionData} from 'teenybase'
import {baseFields, authFields, createdTrigger, updatedTrigger} from 'teenybase/scaffolds/fields'

export const usersTable: TableData = {
    name: 'users',
    autoSetUid: true,
    fields: [
        ...baseFields,
        ...authFields,
        {name: 'phone', type: 'text', sqlType: 'text'},
        {name: 'citizenship', type: 'text', sqlType: 'text'},
        {name: 'date_of_birth', type: 'date', sqlType: 'text'},
        {name: 'address_line1', type: 'text', sqlType: 'text'},
        {name: 'address_line2', type: 'text', sqlType: 'text'},
        {name: 'city', type: 'text', sqlType: 'text'},
        {name: 'state', type: 'text', sqlType: 'text'},
        {name: 'zip', type: 'text', sqlType: 'text'},
        {name: 'ssn_last4', type: 'text', sqlType: 'text'},
        {name: 'signature_file', type: 'file', sqlType: 'text'},
        {name: 'resting_hr_bpm', type: 'number', sqlType: 'integer'},
        {name: 'oura_access_token', type: 'text', sqlType: 'text'},
    ],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [
        {
            name: 'auth',
            passwordType: 'sha256',
            jwtSecret: '$JWT_SECRET_USERS',
            jwtTokenDuration: 3 * 60 * 60,
            maxTokenRefresh: 4,
            passwordConfirmSuffix: 'Confirm',
        } as TableAuthExtensionData,
        {
            name: 'rules',
            // Tier 1 (local): permissive single-user mode. Switch to `auth.uid == id`
            // for tier 2/3 (deployed multi-user). See plans/personal-os-teenybase-port.md.
            listRule: 'true',
            viewRule: 'true',
            createRule: 'true',
            updateRule: 'true',
            deleteRule: 'true',
        } as TableRulesExtensionData,
    ],
}
