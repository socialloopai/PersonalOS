import {DatabaseSettings} from 'teenybase'

import {usersTable} from './modules/users'
import {plaidItemsTable, bankAccountsTable, transactionsTable, liabilitiesTable} from './modules/finance'
import {documentsTable} from './modules/documents'
import {businessEntitiesTable, legalCasesTable, taxYearNotesTable} from './modules/entities-legal-taxes'
import {appleHealthDailyTable, ouraDailyTable} from './modules/health'

export default {
    appName: 'Personal OS',
    appUrl: 'http://localhost:8787',
    jwtSecret: '$JWT_SECRET',
    authCookie: {name: 'personal_os_auth'},
    tables: [
        usersTable,
        // FK order matters for table creation:
        plaidItemsTable,
        bankAccountsTable,
        transactionsTable,
        liabilitiesTable,
        businessEntitiesTable,
        legalCasesTable,
        taxYearNotesTable,
        appleHealthDailyTable,
        ouraDailyTable,
        // documents references entities + legal_cases + bank_accounts, so it goes last
        documentsTable,
    ],
} satisfies DatabaseSettings
