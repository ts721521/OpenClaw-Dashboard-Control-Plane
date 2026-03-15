(function () {
  function cloneDoc(doc) {
    return JSON.parse(JSON.stringify(doc || {}));
  }

  function normalizeStateId(input) {
    const cleaned = String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return cleaned || ('STAGE_' + Math.random().toString(36).slice(2, 6).toUpperCase());
  }

  function transitionTypeLabel(type) {
    return ({
      normal: '正常',
      rework: '返工',
      blocked: '阻塞',
      escalated: '升级',
      failure: '失败',
    })[type] || '正常';
  }

  function inferTransitionType(from, to) {
    if (to === 'REWORK' || from === 'FAILED') return 'rework';
    if (to === 'BLOCKED') return 'blocked';
    if (to === 'ESCALATED') return 'escalated';
    if (to === 'FAILED' || to === 'CANCELLED') return 'failure';
    return 'normal';
  }

  function inferCondition(type) {
    if (type === 'rework') return '返工';
    if (type === 'blocked') return '阻塞';
    if (type === 'escalated') return '人工确认';
    if (type === 'failure') return '失败';
    return '通过';
  }

  function autoLayoutStates(states) {
    return states.reduce(function (acc, stateName, index) {
      const row = Math.floor(index / 4);
      const col = index % 4;
      acc[stateName] = { x: 56 + col * 240, y: 54 + row * 168 };
      return acc;
    }, {});
  }

  function buildWorkflowGraph(teamStateDoc, targetId) {
    const machine = cloneDoc((((teamStateDoc || {}).team_state_machines) || {})[targetId] || {});
    const baseStates = Array.isArray(machine.internal_states) ? machine.internal_states : [];
    const mapping = machine.mapping_to_unified || {};
    const transitions = machine.transitions || {};
    const nodeMeta = machine.node_meta || {};
    const transitionMeta = machine.transition_meta || {};
    const baseHeartbeat = machine.heartbeat_requirements || { interval_seconds: 120, timeout_threshold_seconds: 300 };
    const referencedStates = new Set(baseStates);
    Object.entries(transitions).forEach(function (_ref) {
      const from = _ref[0];
      const targets = _ref[1];
      referencedStates.add(from);
      (targets || []).forEach(function (to) { referencedStates.add(to); });
    });
    const states = Array.from(referencedStates);
    const layout = autoLayoutStates(states);
    const startNodeId = machine.start_node_id || states[0] || null;
    const inferredTerminals = states.filter(function (stateId) {
      const outgoing = transitions[stateId] || [];
      const unified = mapping[stateId] || stateId;
      if (outgoing.length) return false;
      return ['DONE', 'CANCELLED', 'COMPLETED'].includes(unified) || ['DONE', 'CANCELLED', 'COMPLETED'].includes(stateId);
    });
    const terminalNodes = Array.isArray(machine.terminal_nodes) && machine.terminal_nodes.length ? machine.terminal_nodes : inferredTerminals;
    const nodes = states.map(function (stateId) {
      const meta = nodeMeta[stateId] || {};
      const pos = meta.position || layout[stateId] || { x: 60, y: 60 };
      const fallbackUnified = ['BLOCKED', 'REWORK', 'FAILED', 'TIMEOUT', 'ESCALATED', 'CANCELLED', 'DONE'].includes(stateId) ? stateId : 'RUNNING';
      return {
        id: stateId,
        label: stateId,
        unifiedState: mapping[stateId] || fallbackUnified,
        role: meta.role || '',
        description: meta.description || '',
        x: Number.isFinite(pos.x) ? pos.x : 60,
        y: Number.isFinite(pos.y) ? pos.y : 60,
        heartbeatInterval: Number(meta.heartbeat_interval_seconds || baseHeartbeat.interval_seconds || 120),
        heartbeatTimeout: Number(meta.heartbeat_timeout_seconds || baseHeartbeat.timeout_threshold_seconds || 300),
        isStart: stateId === startNodeId,
        isTerminal: terminalNodes.includes(stateId),
      };
    });
    const edges = [];
    Object.entries(transitions).forEach(function (_ref) {
      const from = _ref[0];
      const targets = _ref[1];
      (targets || []).forEach(function (to) {
        const key = from + '->' + to;
        const meta = transitionMeta[key] || {};
        const transitionType = meta.transition_type || inferTransitionType(from, to);
        edges.push({
          key,
          from,
          to,
          transitionType,
          condition: meta.condition || inferCondition(transitionType),
          requiresConfirmation: Boolean(meta.requires_confirmation),
        });
      });
    });
    return {
      targetId,
      nodes,
      edges,
      startNodeId,
      terminalNodes,
      defaults: {
        intervalSeconds: Number(baseHeartbeat.interval_seconds || 120),
        timeoutThresholdSeconds: Number(baseHeartbeat.timeout_threshold_seconds || 300),
      },
      version: (teamStateDoc || {}).version || '1.0.0',
      lastPublishedAt: (((teamStateDoc || {}).metadata || {}).last_published_at) || (teamStateDoc || {}).created_at || null,
    };
  }

  function validateWorkflowGraph(graph) {
    const issues = [];
    if (!graph || !graph.nodes || !graph.nodes.length) {
      issues.push('至少需要一个阶段节点。');
      return issues;
    }
    const nodeIds = new Set(graph.nodes.map(function (node) { return node.id; }));
    if (!graph.startNodeId || !nodeIds.has(graph.startNodeId)) issues.push('必须指定开始节点。');
    const inCount = {};
    const outCount = {};
    graph.nodes.forEach(function (node) {
      inCount[node.id] = 0;
      outCount[node.id] = 0;
    });
    graph.edges.forEach(function (edge) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        issues.push('存在非法连线 ' + edge.key + '，目标节点不存在。');
        return;
      }
      outCount[edge.from] += 1;
      inCount[edge.to] += 1;
    });
    graph.nodes.forEach(function (node) {
      if (graph.nodes.length > 1 && inCount[node.id] === 0 && outCount[node.id] === 0) {
        issues.push('节点 ' + node.id + ' 是孤立节点。');
      }
      if (node.isTerminal && outCount[node.id] > 0) {
        issues.push('终止节点 ' + node.id + ' 不能继续外流转。');
      }
    });
    const terminalIds = graph.nodes.filter(function (node) { return node.isTerminal; }).map(function (node) { return node.id; });
    if (!terminalIds.length) issues.push('必须至少标记一个终止节点。');
    const adjacency = graph.edges.reduce(function (acc, edge) {
      acc[edge.from] = acc[edge.from] || [];
      acc[edge.from].push(edge.to);
      return acc;
    }, {});
    if (graph.startNodeId && nodeIds.has(graph.startNodeId)) {
      const visited = new Set();
      const stack = [graph.startNodeId];
      while (stack.length) {
        const current = stack.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        (adjacency[current] || []).forEach(function (next) {
          if (!visited.has(next)) stack.push(next);
        });
      }
      if (!terminalIds.some(function (id) { return visited.has(id); })) {
        issues.push('从开始节点必须至少能走到一个终止节点。');
      }
    }
    graph.edges.forEach(function (edge) {
      if (edge.transitionType === 'rework' && !nodeIds.has(edge.to)) {
        issues.push('返工边 ' + edge.key + ' 必须指向有效节点。');
      }
    });
    return Array.from(new Set(issues));
  }

  function serializeWorkflowGraph(teamStateDoc, targetId, graph) {
    const doc = cloneDoc(teamStateDoc || {});
    if (!doc.team_state_machines) doc.team_state_machines = {};
    const existingMachine = cloneDoc(doc.team_state_machines[targetId] || {});
    const sortedNodes = [].concat(graph.nodes).sort(function (a, b) {
      if (a.id === graph.startNodeId) return -1;
      if (b.id === graph.startNodeId) return 1;
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    });
    const machine = {
      ...existingMachine,
      internal_states: sortedNodes.map(function (node) { return node.id; }),
      mapping_to_unified: {},
      transitions: {},
      heartbeat_requirements: {
        interval_seconds: Number(graph.defaults.intervalSeconds || 120),
        timeout_threshold_seconds: Number(graph.defaults.timeoutThresholdSeconds || 300),
      },
      start_node_id: graph.startNodeId,
      terminal_nodes: graph.nodes.filter(function (node) { return node.isTerminal; }).map(function (node) { return node.id; }),
      node_meta: {},
      transition_meta: {},
    };
    graph.nodes.forEach(function (node) {
      machine.mapping_to_unified[node.id] = node.unifiedState;
      machine.node_meta[node.id] = {
        role: node.role || '',
        description: node.description || '',
        position: { x: Math.round(node.x), y: Math.round(node.y) },
        heartbeat_interval_seconds: Number(node.heartbeatInterval || graph.defaults.intervalSeconds || 120),
        heartbeat_timeout_seconds: Number(node.heartbeatTimeout || graph.defaults.timeoutThresholdSeconds || 300),
      };
    });
    graph.edges.forEach(function (edge) {
      machine.transitions[edge.from] = machine.transitions[edge.from] || [];
      if (!machine.transitions[edge.from].includes(edge.to)) machine.transitions[edge.from].push(edge.to);
      machine.transition_meta[edge.key] = {
        transition_type: edge.transitionType,
        condition: edge.condition,
        requires_confirmation: Boolean(edge.requiresConfirmation),
      };
    });
    doc.team_state_machines[targetId] = machine;
    doc.metadata = doc.metadata || {};
    doc.metadata.last_designed_at = new Date().toISOString();
    doc.metadata.last_designed_team = targetId;
    return doc;
  }

  window.WorkflowDesignerModel = {
    cloneDoc,
    normalizeStateId,
    transitionTypeLabel,
    buildWorkflowGraph,
    validateWorkflowGraph,
    serializeWorkflowGraph,
  };
})();
