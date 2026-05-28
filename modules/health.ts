import {TableData, TableRulesExtensionData} from 'teenybase'
import {baseFields, createdTrigger, updatedTrigger} from 'teenybase/scaffolds/fields'

const permissive: TableRulesExtensionData = {
    name: 'rules',
    listRule: 'true', viewRule: 'true', createRule: 'true', updateRule: 'true', deleteRule: 'true',
}

// Populated by iOS Shortcut POST → /api/health/apple
// Idempotent upsert on (owner_id, date)
export const appleHealthDailyTable: TableData = {
    name: 'apple_health_daily',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'date', type: 'date', sqlType: 'text', notNull: true},
        {name: 'rhr_bpm', type: 'number', sqlType: 'integer'},
        {name: 'hrv_ms', type: 'number', sqlType: 'integer'},
        {name: 'steps', type: 'number', sqlType: 'integer'},
        {name: 'active_kcal', type: 'number', sqlType: 'integer'},
        {name: 'sleep_hours', type: 'number', sqlType: 'real'},
        {name: 'body_fat_pct', type: 'number', sqlType: 'real'},
        {name: 'weight_kg', type: 'number', sqlType: 'real'},
    ],
    indexes: [
        {fields: 'owner_id, date', unique: true},
        {fields: 'date'},
    ],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

// Populated by Cloudflare cron pulling Oura v2 API using owner's stored access token.
// Idempotent upsert on (owner_id, date)
export const ouraDailyTable: TableData = {
    name: 'oura_daily',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'date', type: 'date', sqlType: 'text', notNull: true},
        {name: 'readiness_score', type: 'number', sqlType: 'integer'},
        {name: 'sleep_score', type: 'number', sqlType: 'integer'},
        {name: 'activity_score', type: 'number', sqlType: 'integer'},
        {name: 'total_sleep_hrs', type: 'number', sqlType: 'real'},
        {name: 'rhr_bpm', type: 'number', sqlType: 'integer'},
        {name: 'hrv_ms', type: 'number', sqlType: 'integer'},
    ],
    indexes: [
        {fields: 'owner_id, date', unique: true},
        {fields: 'date'},
    ],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

// Manual nutrition log (per meal). Was dropped in the first port pass and
// brought back for feature parity with the original PersonalOS.
export const nutritionLogTable: TableData = {
    name: 'nutrition_log',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'date', type: 'date', sqlType: 'text', notNull: true},
        {name: 'meal_label', type: 'text', sqlType: 'text'},
        {name: 'protein_g', type: 'number', sqlType: 'real'},
        {name: 'calories', type: 'number', sqlType: 'integer'},
        {name: 'carbs_g', type: 'number', sqlType: 'real'},
        {name: 'fat_g', type: 'number', sqlType: 'real'},
        {name: 'notes', type: 'text', sqlType: 'text'},
    ],
    indexes: [{fields: 'owner_id'}, {fields: 'date'}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

export const workoutsTable: TableData = {
    name: 'workouts',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'date', type: 'date', sqlType: 'text', notNull: true},
        {name: 'workout_type', type: 'text', sqlType: 'text'},
        {name: 'duration_min', type: 'number', sqlType: 'integer'},
        {name: 'notes', type: 'text', sqlType: 'text'},
    ],
    indexes: [{fields: 'owner_id'}, {fields: 'date'}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}

export const dailyCheckinTable: TableData = {
    name: 'daily_checkin',
    autoSetUid: true,
    fields: [
        ...baseFields,
        {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
        {name: 'date', type: 'date', sqlType: 'text', notNull: true},
        {name: 'mood', type: 'number', sqlType: 'integer'},
        {name: 'energy', type: 'number', sqlType: 'integer'},
        {name: 'notes', type: 'text', sqlType: 'text'},
    ],
    indexes: [{fields: 'owner_id, date', unique: true}],
    triggers: [createdTrigger, updatedTrigger],
    extensions: [permissive],
}
