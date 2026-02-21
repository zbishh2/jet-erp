// NCR Status - matches BPF stages
// Flow: Submitted → Reviewed → RCA → Corrective Actions → Pending Closure → Closed
// If requiresRca=false: Submitted → Reviewed → Pending Closure → Closed
export const NCRStatus = {
  SUBMITTED: 'SUBMITTED',
  REVIEWED: 'REVIEWED',
  RCA: 'RCA',
  CORRECTIVE_ACTIONS: 'CORRECTIVE_ACTIONS',
  PENDING_CLOSURE: 'PENDING_CLOSURE',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;

export type NCRStatus = (typeof NCRStatus)[keyof typeof NCRStatus];

// RCA Status - matches BPF stages
export const RCAStatus = {
  DRAFT: 'DRAFT',
  IN_PROGRESS: 'IN_PROGRESS',
  IN_REVIEW: 'IN_REVIEW',
  APPROVED: 'APPROVED',
} as const;

export type RCAStatus = (typeof RCAStatus)[keyof typeof RCAStatus];

// CA Type - Type of corrective action
export const CAType = {
  CORRECTIVE: 'CORRECTIVE',
  PREVENTIVE: 'PREVENTIVE',
  CONTAINMENT: 'CONTAINMENT',
  SYSTEM_IMPROVEMENT: 'SYSTEM_IMPROVEMENT',
} as const;

export type CAType = (typeof CAType)[keyof typeof CAType];

// CA Status (4-state simple lifecycle)
export const CAStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  VERIFIED: 'VERIFIED',
} as const;

export type CAStatus = (typeof CAStatus)[keyof typeof CAStatus];

// Effectiveness Check Method - How effectiveness will be verified
export const EffectivenessCheckMethod = {
  AUDIT: 'AUDIT',
  INSPECTION: 'INSPECTION',
  KPI_REVIEW: 'KPI_REVIEW',
  DOCUMENT_REVIEW: 'DOCUMENT_REVIEW',
  PROCESS_OBSERVATION: 'PROCESS_OBSERVATION',
  CUSTOMER_FEEDBACK: 'CUSTOMER_FEEDBACK',
  OTHER: 'OTHER',
} as const;

export type EffectivenessCheckMethod = (typeof EffectivenessCheckMethod)[keyof typeof EffectivenessCheckMethod];

// Detection Category - How the issue was found
export const DetectionCategory = {
  INCOMING_INSPECTION: 'INCOMING_INSPECTION',
  IN_PROCESS_INSPECTION: 'IN_PROCESS_INSPECTION',
  FINAL_INSPECTION: 'FINAL_INSPECTION',
  TEST_MEASUREMENT: 'TEST_MEASUREMENT',
  INTERNAL_AUDIT: 'INTERNAL_AUDIT',
  EXTERNAL_AUDIT: 'EXTERNAL_AUDIT',
  DOCUMENT_REVIEW: 'DOCUMENT_REVIEW',
  ENGINEERING_REVIEW: 'ENGINEERING_REVIEW',
  PLANNING_REVIEW: 'PLANNING_REVIEW',
  OPERATOR_REPORT: 'OPERATOR_REPORT',
  CUSTOMER_COMPLAINT: 'CUSTOMER_COMPLAINT',
  SUPPLIER_NOTIFICATION: 'SUPPLIER_NOTIFICATION',
  KPI_SIGNAL: 'KPI_SIGNAL',
  SYSTEM_ALERT: 'SYSTEM_ALERT',
  OTHER: 'OTHER',
} as const;

export type DetectionCategory = (typeof DetectionCategory)[keyof typeof DetectionCategory];

// Failure Mode Category - What class of system failed
export const FailureModeCategory = {
  MATERIAL_SUPPLIER: 'MATERIAL_SUPPLIER',
  PROCESS_EXECUTION: 'PROCESS_EXECUTION',
  DESIGN_ENGINEERING: 'DESIGN_ENGINEERING',
  PLANNING_MANAGEMENT: 'PLANNING_MANAGEMENT',
  QUALITY_SYSTEM: 'QUALITY_SYSTEM',
  CUSTOMER_EXTERNAL: 'CUSTOMER_EXTERNAL',
} as const;

export type FailureModeCategory = (typeof FailureModeCategory)[keyof typeof FailureModeCategory];

// Failure Mode Detail - How the failure manifested
export const FailureModeDetail = {
  DELAY: 'DELAY',
  INCORRECT: 'INCORRECT',
  DAMAGED: 'DAMAGED',
  OVERRUN: 'OVERRUN',
  PERFORMANCE_ISSUE: 'PERFORMANCE_ISSUE',
  MISSING: 'MISSING',
  NOT_FOLLOWED: 'NOT_FOLLOWED',
  INEFFECTIVE: 'INEFFECTIVE',
  OTHER: 'OTHER',
} as const;

export type FailureModeDetail = (typeof FailureModeDetail)[keyof typeof FailureModeDetail];

// Failure Source - Where the failure originated
export const FailureSource = {
  INTERNAL: 'INTERNAL',
  SUPPLIER: 'SUPPLIER',
  CUSTOMER: 'CUSTOMER',
  EXTERNAL: 'EXTERNAL',
} as const;

export type FailureSource = (typeof FailureSource)[keyof typeof FailureSource];

// Root Cause Category
export const RootCauseCategory = {
  NO_PROCEDURE: 'NO_PROCEDURE',
  PROCEDURE_NOT_FOLLOWED: 'PROCEDURE_NOT_FOLLOWED',
  PROCEDURE_INADEQUATE: 'PROCEDURE_INADEQUATE',
  TRAINING_NOT_PROVIDED: 'TRAINING_NOT_PROVIDED',
  TRAINING_INEFFECTIVE: 'TRAINING_INEFFECTIVE',
  DESIGN_DEFICIENCY: 'DESIGN_DEFICIENCY',
  PLANNING_FAILURE: 'PLANNING_FAILURE',
  SUPPLIER_PROCESS_FAILURE: 'SUPPLIER_PROCESS_FAILURE',
  SYSTEM_DATA_INTEGRITY: 'SYSTEM_DATA_INTEGRITY',
  MANAGEMENT_OVERSIGHT_FAILURE: 'MANAGEMENT_OVERSIGHT_FAILURE',
  OTHER: 'OTHER',
} as const;

export type RootCauseCategory = (typeof RootCauseCategory)[keyof typeof RootCauseCategory];

// Conclusion Strength - Strength of Root Cause Conclusion
export const ConclusionStrength = {
  WEAK: 'WEAK',
  MODERATE: 'MODERATE',
  STRONG: 'STRONG',
  VERY_STRONG: 'VERY_STRONG',
  VERIFIED: 'VERIFIED',
} as const;

export type ConclusionStrength = (typeof ConclusionStrength)[keyof typeof ConclusionStrength];

// Financial Risk - Risk level if recurrence occurs
export const FinancialRisk = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  SEVERE: 'SEVERE',
} as const;

export type FinancialRisk = (typeof FinancialRisk)[keyof typeof FinancialRisk];

// User Roles
export const UserRole = {
  // Organization-wide roles
  REPORTER: 'REPORTER',
  QUALITY: 'QUALITY',
  PROCESS_OWNER: 'PROCESS_OWNER',
  APPROVER: 'APPROVER',
  ADMIN: 'ADMIN',
  // Project Reporting module roles
  PR_ADMIN: 'PR_ADMIN',
  PR_REPORTER: 'PR_REPORTER',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

// Role display names (for UI)
export const UserRoleDisplay: Record<UserRole, string> = {
  REPORTER: 'Reporter',
  QUALITY: 'Quality',
  PROCESS_OWNER: 'Process Owner',
  APPROVER: 'Approver',
  ADMIN: 'Admin',
  PR_ADMIN: 'Admin',
  PR_REPORTER: 'Reporter',
};

// Per-module role definitions
export const ModuleRoles = {
  qms:         ['ADMIN', 'QUALITY', 'PROCESS_OWNER', 'APPROVER', 'REPORTER'],
  maintenance: ['ADMIN', 'TECHNICIAN', 'PLANNER', 'VIEWER'],
  ci:          ['ADMIN', 'FACILITATOR', 'CONTRIBUTOR', 'VIEWER'],
  erp:         ['ADMIN', 'ESTIMATOR', 'VIEWER'],
  pr:          ['ADMIN', 'REPORTER'],
} as const;

export const ModuleRoleDescriptions: Record<string, Record<string, string>> = {
  qms: {
    ADMIN: 'Full access including user management',
    QUALITY: 'Manage NCRs, RCAs, and corrective actions',
    PROCESS_OWNER: 'Receives corrective action assignments',
    APPROVER: 'Approve NCRs and closure requests',
    REPORTER: 'Create and submit NCRs',
  },
  maintenance: {
    ADMIN: 'Full access to maintenance module',
    TECHNICIAN: 'Execute work orders and log maintenance',
    PLANNER: 'Create and schedule PM work orders',
    VIEWER: 'View-only access',
  },
  ci: {
    ADMIN: 'Full access to CI module',
    FACILITATOR: 'Manage action plans, audits, and walks',
    CONTRIBUTOR: 'Submit ideas and participate',
    VIEWER: 'View-only access',
  },
  erp: {
    ADMIN: 'Full access to ERP module',
    ESTIMATOR: 'Create and manage quotes',
    VIEWER: 'View-only access',
  },
  pr: {
    ADMIN: 'Full access including invoicing and CRM',
    REPORTER: 'Submit timesheets',
  },
};

// Entity Type (for polymorphic comments/attachments)
export const EntityType = {
  NCR: 'NCR',
  RCA: 'RCA',
  CA: 'CA',
  ISO_AUDIT: 'ISO_AUDIT',
  ISO_AUDIT_FINDING: 'ISO_AUDIT_FINDING',
} as const;

export type EntityType = (typeof EntityType)[keyof typeof EntityType];

// Disposition - How the non-conforming item was handled
export const Disposition = {
  USE_AS_IS: 'USE_AS_IS',
  REWORK: 'REWORK',
  REPAIR: 'REPAIR',
  SCRAP: 'SCRAP',
  RETURN_TO_SUPPLIER: 'RETURN_TO_SUPPLIER',
  REPLACE_REMAKE: 'REPLACE_REMAKE',
  REINSPECT_SORT: 'REINSPECT_SORT',
  DEVIATION_CONCESSION: 'DEVIATION_CONCESSION',
} as const;

export type Disposition = (typeof Disposition)[keyof typeof Disposition];

// Impact Category - What area was affected
export const ImpactCategory = {
  QUALITY: 'QUALITY',
  DELIVERY: 'DELIVERY',
  COST: 'COST',
  SAFETY: 'SAFETY',
  COMPLIANCE: 'COMPLIANCE',
} as const;

export type ImpactCategory = (typeof ImpactCategory)[keyof typeof ImpactCategory];

// Severity - How serious is the issue
export const Severity = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
  NON_RCA: 'NON_RCA', // Issue doesn't require RCA (legacy)
  QUALITY_ALERT: 'QUALITY_ALERT', // Quality alert notification (legacy)
} as const;

export type Severity = (typeof Severity)[keyof typeof Severity];

// Effectiveness Result - Outcome of effectiveness check
export const EffectivenessResult = {
  EFFECTIVE: 'EFFECTIVE',
  NOT_EFFECTIVE: 'NOT_EFFECTIVE',
  NOT_YET_DUE: 'NOT_YET_DUE',
  NOT_PERFORMED: 'NOT_PERFORMED',
} as const;

export type EffectivenessResult = (typeof EffectivenessResult)[keyof typeof EffectivenessResult];

// ============================================
// ISO Audit Enums
// ============================================

// ISO Audit Status - Workflow states
export const IsoAuditStatus = {
  CREATED: 'CREATED',
  SCHEDULE: 'SCHEDULE',
  IN_PROGRESS: 'IN_PROGRESS',
  REVIEW: 'REVIEW',
  COMPLETE: 'COMPLETE',
} as const;

export type IsoAuditStatus = (typeof IsoAuditStatus)[keyof typeof IsoAuditStatus];

// ISO Audit Type - Internal vs External
export const IsoAuditType = {
  INTERNAL: 'INTERNAL',
  EXTERNAL: 'EXTERNAL',
} as const;

export type IsoAuditType = (typeof IsoAuditType)[keyof typeof IsoAuditType];

// ISO Audit Overall Result - Final audit outcome
export const IsoAuditOverallResult = {
  PASS: 'PASS',
  PASS_WITH_OBSERVATIONS: 'PASS_WITH_OBSERVATIONS',
  FAIL: 'FAIL',
} as const;

export type IsoAuditOverallResult = (typeof IsoAuditOverallResult)[keyof typeof IsoAuditOverallResult];

// ISO Audit Line Severity - Finding severity
export const IsoAuditLineSeverity = {
  CONFORMING: 'CONFORMING',
  OBSERVATION: 'OBSERVATION',
  MINOR: 'MINOR',
  MAJOR: 'MAJOR',
} as const;

export type IsoAuditLineSeverity = (typeof IsoAuditLineSeverity)[keyof typeof IsoAuditLineSeverity];

// ISO Audit Line Category - Grouping for audit questions
export const IsoAuditLineCategory = {
  PROCESS_DEFINITION_OWNERSHIP: 'PROCESS_DEFINITION_OWNERSHIP',
  TRAINING_COMPETENCY: 'TRAINING_COMPETENCY',
  DATA_RECORDS_TRACEABILITY: 'DATA_RECORDS_TRACEABILITY',
  EQUIPMENT_RESOURCES: 'EQUIPMENT_RESOURCES',
  RISK_OPPORTUNITY: 'RISK_OPPORTUNITY',
  COMPLIANCE_CONFORMANCE: 'COMPLIANCE_CONFORMANCE',
  CONTINUAL_IMPROVEMENT: 'CONTINUAL_IMPROVEMENT',
  MANAGEMENT_REVIEW_OVERSIGHT: 'MANAGEMENT_REVIEW_OVERSIGHT',
  EXECUTION_STANDARD_WORK: 'EXECUTION_STANDARD_WORK',
  ISSUE_HANDLING_ESCALATION: 'ISSUE_HANDLING_ESCALATION',
  INTERNAL_AUDIT: 'INTERNAL_AUDIT',
  MATERIAL_PRODUCT_CONTROL: 'MATERIAL_PRODUCT_CONTROL',
  SYSTEM_CONTROLS: 'SYSTEM_CONTROLS',
} as const;

export type IsoAuditLineCategory = (typeof IsoAuditLineCategory)[keyof typeof IsoAuditLineCategory];

// ============================================
// Project Reporting Enums
// ============================================

// PR Account Type - Lead/prospect/customer lifecycle
export const PrAccountType = {
  LEAD: 'lead',
  PROSPECT: 'prospect',
  CUSTOMER: 'customer',
  DORMANT: 'dormant',
} as const;

export type PrAccountType = (typeof PrAccountType)[keyof typeof PrAccountType];

// PR Account/Contact Status
export const PrStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const;

export type PrStatus = (typeof PrStatus)[keyof typeof PrStatus];

// PR Project Type
export const PrProjectType = {
  CONSULTING: 'consulting',
  COACHING: 'coaching',
  TRAINING: 'training',
  OTHER: 'other',
} as const;

export type PrProjectType = (typeof PrProjectType)[keyof typeof PrProjectType];

// PR Project Status
export const PrProjectStatus = {
  ACTIVE: 'active',
  ON_HOLD: 'on_hold',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type PrProjectStatus = (typeof PrProjectStatus)[keyof typeof PrProjectStatus];

// PR Invoice Status
export const PrInvoiceStatus = {
  DRAFT: 'draft',
  OUTSTANDING: 'outstanding',
  PAID: 'paid',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
} as const;

export type PrInvoiceStatus = (typeof PrInvoiceStatus)[keyof typeof PrInvoiceStatus];

// PR Timesheet Status
export const PrTimesheetStatus = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
} as const;

export type PrTimesheetStatus = (typeof PrTimesheetStatus)[keyof typeof PrTimesheetStatus];
