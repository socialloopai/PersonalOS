import {DatabaseSettings} from 'teenybase'

import {usersTable} from './modules/users'
import {plaidItemsTable, bankAccountsTable, transactionsTable, liabilitiesTable} from './modules/finance'
import {documentsTable} from './modules/documents'
import {businessEntitiesTable, legalCasesTable, taxYearNotesTable} from './modules/entities-legal-taxes'
import {appleHealthDailyTable, ouraDailyTable, nutritionLogTable, workoutsTable, dailyCheckinTable} from './modules/health'
import {projectsTable, tasksTable, projectSnapshotsTable} from './modules/projects'
import {reflectionsTable, snapshotsTable, snapshotRunsTable, debriefsTable} from './modules/reflections-snapshots'
import {soulItemsTable, soulLogsTable, soulItemStepsTable, soulStepLogsTable} from './modules/soul'

export default {
    appName: 'Personal OS',
    appUrl: 'http://localhost:8787',
    jwtSecret: '$JWT_SECRET',
    authCookie: {name: 'personal_os_auth'},
    tables: [
        usersTable,
        // FK order matters for table creation. Projects must precede tasks + soul_items
        // since both reference it. Snapshots precede snapshot_runs + debriefs.
        projectsTable,
        tasksTable,
        projectSnapshotsTable,
        reflectionsTable,
        snapshotsTable,
        snapshotRunsTable,
        debriefsTable,
        soulItemsTable,
        soulLogsTable,
        soulItemStepsTable,
        soulStepLogsTable,
        plaidItemsTable,
        bankAccountsTable,
        transactionsTable,
        liabilitiesTable,
        businessEntitiesTable,
        legalCasesTable,
        taxYearNotesTable,
        appleHealthDailyTable,
        ouraDailyTable,
        nutritionLogTable,
        workoutsTable,
        dailyCheckinTable,
        // documents references entities + legal_cases + bank_accounts, so it goes last
        documentsTable,
    ],
} satisfies DatabaseSettings
