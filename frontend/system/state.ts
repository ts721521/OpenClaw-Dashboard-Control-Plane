// @ts-nocheck
export const state: any = {
  view: 'architecture',
  architecture: null,
  teams: [],
  standaloneAgents: [],
  tasks: [],
  flows: [],
  flowDetail: null,
  runtimeVersions: null,
  updatedAt: null,
  selectedObjectType: null,
  selectedObjectId: null,
  selectedTeamId: null,
  selectedFlowId: null,
  selectedInterTeamEdge: null,
  selectedWorkflowNodeId: null,
  graphEdit: {
    architecture: null,
    'inter-team-flow': null,
    'team-workflow': null,
  },
  graphEditMode: {
    architecture: false,
    'inter-team-flow': false,
    'team-workflow': false,
  },
  graphConnectMode: {
    architecture: false,
    'inter-team-flow': false,
    'team-workflow': false,
  },
  graphConnectPending: {
    architecture: null,
    'inter-team-flow': null,
    'team-workflow': null,
  },
  graphConnectDrag: {
    architecture: null,
    'inter-team-flow': null,
    'team-workflow': null,
  },
  graphEditStatus: {},
  expandedTeams: {},
  interTeamFlowId: 'inter-team:default',
  architectureLayout: { positions: {}, updatedAt: null },
  interTeamLayout: { positions: {}, updatedAt: null },
  graphZoom: {
    architecture: 1,
    'inter-team-flow': 1,
    'team-workflow': 1,
  },
};

export function safe(value: unknown): string {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}
