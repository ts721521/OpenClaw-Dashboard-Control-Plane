export const state: any = {
  view: 'architecture-map',
  architecture: null,
  flows: [],
  selectedFlowId: null,
  flowDetail: null,
  updatedAt: null,
  teamLeadsDoc: null,
  teamStateDoc: null,
  changeTasks: [],
  reviewTasks: [],
  selectedChangeId: null,
  selectedReviewId: null,
  reviewDetail: null,
  runtimeVersions: null,
  governanceView: 'change',
  recoveryScan: null,
  pendingChanges: {},
  promptProposal: null,
  selectedObjectType: null,
  selectedObjectId: null,
  selectedTargetType: null,
  selectedTargetId: null,
  advancedConfigMode: 'workflow-designer',
  workflowGraphTargetId: null,
  workflowGraph: null,
  selectedWorkflowNodeId: null,
  selectedWorkflowEdgeKey: null,
  workflowLinkFromNodeId: null,
};

export function safe(value: unknown): string {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

export function objectTypeLabel(type: string): string {
  if (type === 'team') return '团队';
  if (type === 'member') return '成员';
  if (type === 'agent') return '独立 Agent';
  return '-';
}
