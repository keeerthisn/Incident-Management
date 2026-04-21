import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Alert,
  CircularProgress,
  Chip,
  List,
  ListItem,
  ListItemText,
  Divider,
  Link,
  MenuItem,
  InputAdornment,
  Collapse,
  IconButton,
  Button,
  Tabs,
  Tab,
} from '@mui/material';
import { OpenInNew, Search, ExpandLess, ExpandMore, BugReport, MenuBook } from '@mui/icons-material';
import { Tooltip } from '@mui/material';
import { API_BASE_URL } from '../config';

interface JiraSettings {
  url: string;
  email: string;
  apiToken: string;
  projectKey: string;
  daysBack?: number;
  jql?: string;
  confluenceSpaces?: string;
}

interface DuplicateCandidate {
  ticketKey: string;
  summary: string;
  status: string;
  priority: string;
  productName?: string;
  similarityConfidence: number;
  reference?: string | null;
  resolutionNotes?: string;
  matchingPatterns: {
    commonComponents: string[];
    commonLabels: string[];
    knownRegressionWords: string[];
  };
  resolutionSnippet: string;
}


const scoreColor = (score: number) => {
  if (score >= 70) return 'error';
  if (score >= 45) return 'warning';
  return 'default';
};

const ISSUE_TYPES: Array<{ label: string; keywords: string[] }> = [
  { label: 'Backup Failures', keywords: ['backup fail', 'backup error', 'failed backup', 'backup unsuccessful'] },
  { label: 'Restore / Recovery', keywords: ['restore', 'recovery', 'point-in-time', 'granular restore'] },
  { label: 'Timeout / Connection', keywords: ['timeout', 'timed out', 'connection', 'disconnect', 'network', 'socket'] },
  { label: 'Authentication / Access', keywords: ['auth', 'login', 'credential', 'password', 'token', 'access denied', 'oauth', 'sso'] },
  { label: 'Storage / Quota', keywords: ['storage', 'quota', 'disk', 'space', 'capacity', 'full'] },
  { label: 'Sync / Replication', keywords: ['sync', 'replication', 'replicate', 'mirror'] },
  { label: 'Email / Exchange', keywords: ['email', 'exchange', 'mailbox', 'outlook', 'smtp'] },
  { label: 'SharePoint / OneDrive', keywords: ['sharepoint', 'onedrive', 'teams', 'm365', 'microsoft 365'] },
  { label: 'API / Integration', keywords: ['api', 'integration', 'webhook', 'endpoint', 'rest', 'sdk'] },
  { label: 'Performance / Slow', keywords: ['slow', 'performance', 'latency', 'lag', 'degraded', 'high cpu', 'memory'] },
  { label: 'Error / Crash', keywords: ['error', 'crash', 'exception', '500', '503', 'failed'] },
];

const ISSUE_TYPE_STYLES: Record<string, { color: string; bg: string }> = {
  'Backup Failures': { color: '#c62828', bg: '#ffebee' },
  'Restore / Recovery': { color: '#1565c0', bg: '#e3f2fd' },
  'Timeout / Connection': { color: '#e53935', bg: '#fce4ec' },
  'Authentication / Access': { color: '#283593', bg: '#e8eaf6' },
  'Storage / Quota': { color: '#558b2f', bg: '#f1f8e9' },
  'Sync / Replication': { color: '#00695c', bg: '#e0f2f1' },
  'Email / Exchange': { color: '#0277bd', bg: '#e1f5fe' },
  'SharePoint / OneDrive': { color: '#01579b', bg: '#e1f5fe' },
  'API / Integration': { color: '#4527a0', bg: '#ede7f6' },
  'Performance / Slow': { color: '#bf360c', bg: '#fbe9e7' },
  'Error / Crash': { color: '#b71c1c', bg: '#ffebee' },
  Other: { color: '#607d8b', bg: '#eceff1' },
};

const PRIORITY_COLORS: Record<string, string> = {
  Blocker: '#d32f2f',
  Critical: '#d32f2f',
  Major: '#f57c00',
  Moderate: '#0288d1',
};

const STATUS_STYLES: Array<{ match: RegExp; label: string; color: string; bg: string }> = [
  { match: /closed/i, label: 'Closed', color: '#2e7d32', bg: '#e8f5e9' },
  { match: /resolved|done/i, label: 'Resolved', color: '#1565c0', bg: '#e3f2fd' },
  { match: /open|new|to do/i, label: 'Open', color: '#c62828', bg: '#ffebee' },
  { match: /in progress|progress|ongoing/i, label: 'In Progress', color: '#ef6c00', bg: '#fff3e0' },
];

const classifyIssueType = (text: string): string => {
  const normalized = (text || '').toLowerCase();
  for (const issueType of ISSUE_TYPES) {
    if (issueType.keywords.some((keyword) => normalized.includes(keyword))) {
      return issueType.label;
    }
  }
  return 'Other';
};

const getIssueTypeStyle = (issueType: string): { color: string; bg: string } => {
  return ISSUE_TYPE_STYLES[issueType] || ISSUE_TYPE_STYLES.Other;
};

const normalizePriority = (raw?: string): string => {
  if (!raw) return 'Unset';
  const value = raw.trim().toLowerCase();
  if (!value || value === 'unknown' || value === 'undefined' || value === 'none' || value === 'unset') {
    return 'Unset';
  }
  if (value === 'blocker') return 'Blocker';
  if (value === 'critical') return 'Critical';
  if (value === 'major') return 'Major';
  if (value === 'moderate') return 'Moderate';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

const normalizeStatus = (raw?: string): { label: string; color: string; bg: string } => {
  const text = (raw || 'Unknown').trim();
  for (const style of STATUS_STYLES) {
    if (style.match.test(text)) {
      return { label: style.label, color: style.color, bg: style.bg };
    }
  }
  return { label: text || 'Unknown', color: '#616161', bg: '#f5f5f5' };
};

const getStatusSortRank = (raw?: string): number => {
  const status = (raw || '').toLowerCase();
  if (/open|new|to do/.test(status)) return 0;
  if (/in progress|progress|ongoing/.test(status)) return 1;
  if (/resolved|done/.test(status)) return 2;
  if (/closed/.test(status)) return 3;
  return 4;
};

const ResolutionAssistant: React.FC = () => {
  const [error, setError] = useState<string | null>(null);

  // ── Investigation state ──
  const [investigateKey, setInvestigateKey] = useState('');
  const [investigateLoading, setInvestigateLoading] = useState(false);
  const [investigateError, setInvestigateError] = useState<string | null>(null);
  const [investigateResult, setInvestigateResult] = useState<any>(null);
  const [investigateTab, setInvestigateTab] = useState(0);

  // ── Duplicate state ──
  const [defaultDuplicates, setDefaultDuplicates] = useState<DuplicateCandidate[]>([]);
  const [defaultDuplicatesLoading, setDefaultDuplicatesLoading] = useState(false);
  const [duplicateSearch, setDuplicateSearch] = useState('');
  const [duplicatePriorityFilter, setDuplicatePriorityFilter] = useState('all');
  const [duplicateComponentFilter, setDuplicateComponentFilter] = useState('all');
  const [duplicateProductFilter, setDuplicateProductFilter] = useState('all');
  const [duplicateMinConfidence, setDuplicateMinConfidence] = useState('all');
  const [duplicatePanelExpanded, setDuplicatePanelExpanded] = useState(false);
  const [expandedDuplicateGroups, setExpandedDuplicateGroups] = useState<Record<string, boolean>>({});
  const [confluenceLinks, setConfluenceLinks] = useState<Record<string, { url: string; title: string } | null>>({});
  const [confluenceLinksLoading, setConfluenceLinksLoading] = useState(false);
  const confluenceLookedUp = useRef<Set<string>>(new Set());

  const jiraBaseUrl = useMemo(() => {
    try {
      const raw = localStorage.getItem('jiraSettings');
      if (!raw) return '';
      const settings = JSON.parse(raw) as JiraSettings;
      return (settings.url || '').replace(/\/$/, '');
    } catch {
      return '';
    }
  }, []);

  /** Build a Confluence URL for a ticket key — direct page if matched, or search fallback */
  const getConfluenceUrl = useCallback((ticketKey: string): { url: string; title: string; isDirect: boolean } | null => {
    if (!jiraBaseUrl) return null;
    const matched = confluenceLinks[ticketKey];
    if (matched) {
      return { url: matched.url, title: matched.title, isDirect: true };
    }
    // Fallback: link to Confluence search for this ticket key
    const confluenceSpaces = (() => {
      try { return (JSON.parse(localStorage.getItem('jiraSettings') || '{}') as JiraSettings).confluenceSpaces || ''; } catch { return ''; }
    })();
    const spaceParam = confluenceSpaces ? `&where=space+%3D+%22${encodeURIComponent(confluenceSpaces.split(',')[0].trim())}%22` : '';
    const searchUrl = `${jiraBaseUrl}/wiki/search?text=${encodeURIComponent(ticketKey)}${spaceParam}`;
    return { url: searchUrl, title: `Search Confluence for ${ticketKey}`, isDirect: false };
  }, [jiraBaseUrl, confluenceLinks]);

  const getJiraSettings = (): JiraSettings | null => {
    try {
      const raw = localStorage.getItem('jiraSettings');
      if (!raw) return null;
      return JSON.parse(raw) as JiraSettings;
    } catch {
      return null;
    }
  };

  // ── Investigation handler ──
  const handleInvestigate = async (ticketKey?: string) => {
    const key = (ticketKey || investigateKey).trim().toUpperCase();
    if (!key) return;
    const settings = getJiraSettings();
    if (!settings) {
      setInvestigateError('Configure Jira settings first (Settings page).');
      return;
    }
    setInvestigateKey(key);
    setInvestigateLoading(true);
    setInvestigateError(null);
    setInvestigateResult(null);
    setInvestigateTab(0);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const resp = await fetch(`${API_BASE_URL}/api/resolution-assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketKey: key, jiraSettings: settings }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.detail || `Investigation failed (${resp.status})`);
      setInvestigateResult(data);
      // Fetch Confluence links for the investigated ticket AND similar tickets
      const similarTickets = data.similarOrDuplicateTickets || [];
      const allKeys = [key, ...similarTickets.map((t: any) => t.ticketKey).filter(Boolean)];
      {
        const newKeys = allKeys.filter((k: string) => !confluenceLookedUp.current.has(k));
        if (newKeys.length > 0) {
          newKeys.forEach((k: string) => confluenceLookedUp.current.add(k));
          fetch(`${API_BASE_URL}/api/batch-confluence-links`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticketKeys: newKeys.slice(0, 50), jiraSettings: settings }),
          })
            .then((r) => r.json())
            .then((d) => {
              if (d.links) setConfluenceLinks((prev) => ({ ...prev, ...d.links }));
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        setInvestigateError('Investigation timed out after 90 seconds.');
      } else {
        setInvestigateError(err instanceof Error ? err.message : 'Investigation failed');
      }
    } finally {
      setInvestigateLoading(false);
    }
  };

  const loadDefaultDuplicates = useCallback(async () => {
    setDefaultDuplicatesLoading(true);
    try {
      const params = new URLSearchParams({ minConfidence: '40', limit: '200' });
      try {
        const raw = localStorage.getItem('jiraSettings');
        if (raw) {
          const settings = JSON.parse(raw) as JiraSettings;
          if (settings.projectKey) params.set('projectKey', settings.projectKey);
          if (settings.daysBack && Number.isFinite(settings.daysBack)) {
            params.set('daysBack', String(settings.daysBack));
          }
        }
      } catch {
        // fallback to backend defaults
      }

      const response = await fetch(`${API_BASE_URL}/api/duplicate-candidates?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || `Duplicate discovery failed (${response.status})`);
      }
      setError(null);
      setDefaultDuplicates(Array.isArray(payload.tickets) ? (payload.tickets as DuplicateCandidate[]) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load duplicate tickets');
      setDefaultDuplicates([]);
    } finally {
      setDefaultDuplicatesLoading(false);
    }
  }, []);

  const loadConfluenceLinks = useCallback(async (tickets: DuplicateCandidate[]) => {
    const settings = getJiraSettings();
    if (!settings || tickets.length === 0) return;

    const keys = tickets.map((t) => t.ticketKey).filter(Boolean);
    const newKeys = keys.filter((k) => !confluenceLookedUp.current.has(k));
    if (newKeys.length === 0) return;

    // Mark as looked up immediately to prevent re-fetches
    newKeys.forEach((k) => confluenceLookedUp.current.add(k));
    const batch = newKeys.slice(0, 50);

    setConfluenceLinksLoading(true);
    try {
      const resp = await fetch(`${API_BASE_URL}/api/batch-confluence-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketKeys: batch, jiraSettings: settings }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.links) {
        setConfluenceLinks((prev) => ({ ...prev, ...data.links }));
      }
    } catch {
      // Non-fatal — Confluence links are optional
    } finally {
      setConfluenceLinksLoading(false);
    }
  }, []);

  const handleToggleDuplicatePanel = useCallback(() => {
    setDuplicatePanelExpanded((value) => {
      const nextExpanded = !value;
      if (nextExpanded) {
        setError(null);
        void loadDefaultDuplicates();
      }
      return nextExpanded;
    });
  }, [loadDefaultDuplicates]);

  useEffect(() => {
    void loadDefaultDuplicates();
  }, [loadDefaultDuplicates]);

  // Fetch Confluence page links once duplicates are loaded
  useEffect(() => {
    if (defaultDuplicates.length > 0) {
      void loadConfluenceLinks(defaultDuplicates);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultDuplicates]);

  const duplicateCandidates = useMemo(() => defaultDuplicates, [defaultDuplicates]);

  const duplicatePriorities = useMemo(() => {
    return Array.from(
      new Set(
        duplicateCandidates
          .map((item) => normalizePriority(item.priority)),
      ),
    ).sort();
  }, [duplicateCandidates]);

  const duplicateComponents = useMemo(() => {
    return Array.from(
      new Set(
        duplicateCandidates.flatMap((item) =>
          (item.matchingPatterns?.commonComponents || [])
            .map((component) => (component || '').trim())
            .filter(Boolean),
        ),
      ),
    ).sort();
  }, [duplicateCandidates]);

  const duplicateProducts = useMemo(() => {
    return Array.from(
      new Set(
        duplicateCandidates
          .map((item) => item.productName)
          .filter(Boolean),
      ),
    ).sort();
  }, [duplicateCandidates]);

  const clusteredDuplicateCandidates = useMemo(() => {
    const items = duplicateCandidates;
    if (items.length === 0) {
      return [] as Array<{ group: string; items: DuplicateCandidate[] }>;
    }

    const toTokens = (value: string) =>
      (value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 3);

    const jaccard = (left: Set<string>, right: Set<string>) => {
      if (left.size === 0 || right.size === 0) return 0;
      const union = new Set<string>([...Array.from(left), ...Array.from(right)]);
      let intersection = 0;
      Array.from(left).forEach((token) => {
        if (right.has(token)) intersection += 1;
      });
      return union.size === 0 ? 0 : intersection / union.size;
    };

    const keyToIndex = new Map<string, number>();
    const parent = items.map((_, index) => index);

    const find = (index: number): number => {
      if (parent[index] !== index) {
        parent[index] = find(parent[index]);
      }
      return parent[index];
    };

    const union = (left: number, right: number) => {
      const rootLeft = find(left);
      const rootRight = find(right);
      if (rootLeft !== rootRight) {
        parent[rootRight] = rootLeft;
      }
    };

    items.forEach((item, index) => {
      keyToIndex.set((item.ticketKey || '').toUpperCase(), index);
    });

    const summaryTokenSets = items.map((item) => new Set(toTokens(item.summary || '')));
    const componentSets = items.map((item) => new Set((item.matchingPatterns?.commonComponents || []).map((c) => c.toLowerCase())));

    const referencedTicketRegex = /(NCIP-\d+)/gi;
    items.forEach((item, index) => {
      const snippet = item.resolutionSnippet || '';
      const matches = snippet.match(referencedTicketRegex) || [];
      matches.forEach((match) => {
        const referenced = keyToIndex.get(match.toUpperCase());
        if (referenced !== undefined) {
          union(index, referenced);
        }
      });
    });

    for (let left = 0; left < items.length; left += 1) {
      for (let right = left + 1; right < items.length; right += 1) {
        const summarySim = jaccard(summaryTokenSets[left], summaryTokenSets[right]);
        const componentSim = jaccard(componentSets[left], componentSets[right]);
        const score = (summarySim * 0.8) + (componentSim * 0.2);
        if (score >= 0.34) {
          union(left, right);
        }
      }
    }

    const clusters = new Map<number, DuplicateCandidate[]>();
    items.forEach((item, index) => {
      const root = find(index);
      if (!clusters.has(root)) {
        clusters.set(root, []);
      }
      clusters.get(root)!.push(item);
    });

    return Array.from(clusters.values())
      .map((cluster) => [...cluster].sort((a, b) => (b.similarityConfidence || 0) - (a.similarityConfidence || 0)))
      .sort((left, right) => {
        if (right.length !== left.length) return right.length - left.length;
        return (right[0]?.similarityConfidence || 0) - (left[0]?.similarityConfidence || 0);
      })
      .map((cluster, index) => {
        const issueType = classifyIssueType(cluster.map((item) => item.summary || '').join(' '));

        let groupLabel = `Group ${index + 1}`;
        if (issueType === 'Other') {
          const componentCounts = new Map<string, number>();
          cluster.forEach((item) => {
            (item.matchingPatterns?.commonComponents || [])
              .map((component) => (component || '').trim())
              .filter(Boolean)
              .forEach((component) => {
                componentCounts.set(component, (componentCounts.get(component) || 0) + 1);
              });
          });

          const topComponents = Array.from(componentCounts.entries())
            .sort((left, right) => {
              if (right[1] !== left[1]) return right[1] - left[1];
              return left[0].localeCompare(right[0]);
            })
            .slice(0, 3)
            .map(([name]) => name);

          if (topComponents.length > 0) {
            groupLabel = `Group ${index + 1} • Components: ${topComponents.join(', ')}`;
          }
        }

        return {
          group: `${issueType} — ${groupLabel}`,
          items: cluster,
        };
      });
  }, [duplicateCandidates]);

  const groupedDuplicateCandidates = useMemo(() => {
    const query = duplicateSearch.trim().toLowerCase();
    const minConfidence = duplicateMinConfidence === 'all' ? null : Number(duplicateMinConfidence);

    return clusteredDuplicateCandidates
      .map((cluster) => {
        const filteredItems = cluster.items.filter((item) => {
          const priority = normalizePriority(item.priority);
          if (duplicatePriorityFilter !== 'all' && priority !== duplicatePriorityFilter) {
            return false;
          }

          if (duplicateComponentFilter !== 'all') {
            const components = (item.matchingPatterns?.commonComponents || [])
              .map((component) => (component || '').trim())
              .filter(Boolean);
            if (!components.includes(duplicateComponentFilter)) {
              return false;
            }
          }

          if (duplicateProductFilter !== 'all' && item.productName !== duplicateProductFilter) {
            return false;
          }

          if (minConfidence !== null && (item.similarityConfidence || 0) < minConfidence) {
            return false;
          }

          if (!query) {
            return true;
          }

          const haystack = [
            item.ticketKey,
            item.summary,
            normalizePriority(item.priority),
            ...(item.matchingPatterns?.commonComponents || []),
            ...(item.matchingPatterns?.commonLabels || []),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return haystack.includes(query);
        });

        return {
          ...cluster,
          items: [...filteredItems].sort((left, right) => {
            const rankDiff = getStatusSortRank(left.status) - getStatusSortRank(right.status);
            if (rankDiff !== 0) return rankDiff;
            return (right.similarityConfidence || 0) - (left.similarityConfidence || 0);
          }),
        };
      })
      .filter((cluster) => cluster.items.length > 0);
  }, [clusteredDuplicateCandidates, duplicateComponentFilter, duplicateMinConfidence, duplicatePriorityFilter, duplicateProductFilter, duplicateSearch]);

  useEffect(() => {
    setExpandedDuplicateGroups((previous) => {
      const next: Record<string, boolean> = {};
      groupedDuplicateCandidates.forEach((cluster, index) => {
        next[cluster.group] = previous[cluster.group] ?? index === 0;
      });
      return next;
    });
  }, [groupedDuplicateCandidates]);

  const toggleDuplicateGroup = (groupName: string) => {
    setExpandedDuplicateGroups((previous) => ({
      ...previous,
      [groupName]: !previous[groupName],
    }));
  };

  const getTicketLink = useCallback((item: DuplicateCandidate): string | null => {
    if (item.reference) {
      return item.reference;
    }
    if (jiraBaseUrl && item.ticketKey) {
      return `${jiraBaseUrl}/browse/${item.ticketKey}`;
    }
    return null;
  }, [jiraBaseUrl]);

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        🧭 Resolution Assistant
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Investigate tickets, search the knowledge base, and review grouped similar/duplicate incidents.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* ═══════════ Investigate a Ticket ═══════════ */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <BugReport fontSize="small" /> Investigate a Ticket
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter a Jira ticket key to get root cause analysis, workarounds, Knowledge Base references, and similar tickets.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 2 }}>
            <TextField
              size="small"
              label="Ticket Key"
              placeholder="e.g. NCIP-1234"
              value={investigateKey}
              onChange={(e) => setInvestigateKey(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleInvestigate()}
              sx={{ width: 200 }}
            />
            <Button
              variant="contained"
              onClick={() => handleInvestigate()}
              disabled={investigateLoading || !investigateKey.trim()}
              startIcon={investigateLoading ? <CircularProgress size={18} /> : <Search />}
            >
              {investigateLoading ? 'Investigating…' : 'Investigate'}
            </Button>
          </Box>

          {investigateError && (
            <Alert severity="error" sx={{ mb: 2 }}>{investigateError}</Alert>
          )}

          {investigateResult && (
            <Box sx={{ mt: 2 }}>
              {/* Summary + Confluence link for investigated ticket */}
              {investigateResult.summary && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                    <Box>
                      {(investigateResult.summary as string[]).map((s: string, i: number) => (
                        <Typography key={i} variant="body2">{s}</Typography>
                      ))}
                    </Box>
                    {(() => {
                      const cfl = getConfluenceUrl(investigateKey);
                      if (confluenceLinksLoading && !confluenceLinks[investigateKey]) return <CircularProgress size={16} />;
                      if (!cfl) return null;
                      return (
                        <Tooltip title={cfl.title} arrow>
                          <Link
                            href={cfl.url}
                            target="_blank"
                            rel="noreferrer"
                            underline="hover"
                            sx={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 0.5,
                              fontSize: 13,
                              fontWeight: 700,
                              color: cfl.isDirect ? '#1565c0' : '#6a1b9a',
                              bgcolor: cfl.isDirect ? '#e3f2fd' : '#f3e5f5',
                              border: `1px solid ${cfl.isDirect ? '#90caf944' : '#ce93d844'}`,
                              borderRadius: 1,
                              px: 1.2,
                              py: 0.5,
                              whiteSpace: 'nowrap',
                              flexShrink: 0,
                            }}
                          >
                            <MenuBook sx={{ fontSize: 16 }} /> Confluence <OpenInNew sx={{ fontSize: 12 }} />
                          </Link>
                        </Tooltip>
                      );
                    })()}
                  </Box>
                </Alert>
              )}

              <Tabs value={investigateTab} onChange={(_, v) => setInvestigateTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Tab label="Root Cause" />
                <Tab label="Workarounds" />
                <Tab label="Playbook" />
                <Tab label={`Knowledge Base (${(investigateResult.knowledgeBaseReferences?.references || []).length})`} />
                <Tab label={`Similar (${(investigateResult.similarOrDuplicateTickets || []).length})`} />
              </Tabs>

              {/* Tab 0: Root Cause */}
              {investigateTab === 0 && investigateResult.probableRootCause && (
                <Box>
                  {/* Root cause category + confidence */}
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1, color: '#5B2D91' }}>Root Cause Category</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                      <Chip
                        label={investigateResult.probableRootCause.summary || 'Unknown'}
                        color={investigateResult.probableRootCause.summary === 'Unknown / Needs Investigation' ? 'default' : 'primary'}
                        sx={{ fontWeight: 'bold', fontSize: '0.95rem', py: 0.5 }}
                      />
                      {investigateResult.probableRootCause.confidence != null && (
                        <Chip
                          label={`Confidence: ${Math.round(investigateResult.probableRootCause.confidence * 100)}%`}
                          size="small"
                          color={investigateResult.probableRootCause.confidence >= 0.7 ? 'success' : investigateResult.probableRootCause.confidence >= 0.5 ? 'warning' : 'default'}
                          variant="outlined"
                        />
                      )}
                    </Box>
                    <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                      Based on ticket description, resolution notes, and historical patterns
                    </Typography>
                  </Box>

                  {/* Hypothesis / short summary */}
                  {investigateResult.probableRootCause.hypothesis && (
                    <Typography variant="body1" sx={{ mb: 1.5, color: 'text.secondary' }}>
                      {investigateResult.probableRootCause.hypothesis}
                    </Typography>
                  )}

                  {/* Score breakdown across categories */}
                  {investigateResult.probableRootCause.scoreBreakdown && Object.keys(investigateResult.probableRootCause.scoreBreakdown).length > 0 && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>Score Breakdown</Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {Object.entries(investigateResult.probableRootCause.scoreBreakdown as Record<string, number>)
                          .sort(([, a], [, b]) => b - a)
                          .map(([category, score]) => (
                            <Chip
                              key={category}
                              label={`${category}: ${score}`}
                              size="small"
                              variant={category === investigateResult.probableRootCause.summary ? 'filled' : 'outlined'}
                              color={category === investigateResult.probableRootCause.summary ? 'primary' : 'default'}
                            />
                          ))}
                      </Box>
                    </Box>
                  )}

                  {/* Suggested next steps */}
                  {(investigateResult.probableRootCause.suggestedNextSteps || []).length > 0 && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 0.5 }}>Suggested Next Steps</Typography>
                      <List dense>
                        {(investigateResult.probableRootCause.suggestedNextSteps as string[]).map((step: string, i: number) => (
                          <ListItem key={i}><ListItemText primary={`${i + 1}. ${step}`} /></ListItem>
                        ))}
                      </List>
                    </Box>
                  )}

                  {/* Risk indicators */}
                  {investigateResult.riskIndicators && (
                    <Alert severity={investigateResult.riskIndicators.widespreadRisk ? 'warning' : 'success'} sx={{ mt: 1.5 }}>
                      {investigateResult.riskIndicators.trendSummary}
                    </Alert>
                  )}
                </Box>
              )}

              {/* Tab 1: Workarounds */}
              {investigateTab === 1 && (
                <Box>
                  {(investigateResult.workarounds?.confirmedFixes || []).length > 0 && (
                    <>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>Confirmed Fixes</Typography>
                      <List dense>
                        {(investigateResult.workarounds.confirmedFixes as string[]).map((f: string, i: number) => (
                          <ListItem key={i}><ListItemText primary={f} /></ListItem>
                        ))}
                      </List>
                    </>
                  )}
                  {(investigateResult.workarounds?.temporaryMitigations || []).length > 0 && (
                    <>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mt: 1, mb: 1 }}>Temporary Mitigations</Typography>
                      <List dense>
                        {(investigateResult.workarounds.temporaryMitigations as string[]).map((m: string, i: number) => (
                          <ListItem key={i}><ListItemText primary={m} /></ListItem>
                        ))}
                      </List>
                    </>
                  )}
                  {(investigateResult.workarounds?.confirmedFixes || []).length === 0 &&
                   (investigateResult.workarounds?.temporaryMitigations || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary">No workarounds found for this ticket.</Typography>
                  )}
                </Box>
              )}

              {/* Tab 2: Playbook */}
              {investigateTab === 2 && investigateResult.troubleshootingSteps && (
                <Box>
                  {(investigateResult.troubleshootingSteps.nextActions || []).length > 0 && (
                    <>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>Next Actions</Typography>
                      <List dense>
                        {(investigateResult.troubleshootingSteps.nextActions as string[]).map((a: string, i: number) => (
                          <ListItem key={i}><ListItemText primary={`${i + 1}. ${a}`} /></ListItem>
                        ))}
                      </List>
                    </>
                  )}
                  {investigateResult.troubleshootingSteps.playbook && (
                    <>
                      <Divider sx={{ my: 1 }} />
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>Questions for Customer</Typography>
                      <List dense>
                        {(investigateResult.troubleshootingSteps.playbook.questionsForCustomer || []).map((q: string, i: number) => (
                          <ListItem key={i}><ListItemText primary={q} /></ListItem>
                        ))}
                      </List>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mt: 1, mb: 1 }}>Configurations to Validate</Typography>
                      <List dense>
                        {(investigateResult.troubleshootingSteps.playbook.configurationsToValidate || []).map((c: string, i: number) => (
                          <ListItem key={i}><ListItemText primary={c} /></ListItem>
                        ))}
                      </List>
                    </>
                  )}
                </Box>
              )}

              {/* Tab 3: Knowledge Base Articles */}
              {investigateTab === 3 && (
                <Box>
                  {(investigateResult.knowledgeBaseReferences?.references || []).length > 0 ? (
                    <List dense>
                      {(investigateResult.knowledgeBaseReferences.references as Array<{ title: string; url: string; excerpt: string }>).map((kb, i) => (
                        <React.Fragment key={i}>
                          <ListItem>
                            <ListItemText
                              primary={
                                <Link href={kb.url} target="_blank" rel="noopener" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  {kb.title} <OpenInNew fontSize="inherit" />
                                </Link>
                              }
                              secondary={kb.excerpt}
                            />
                          </ListItem>
                          {i < (investigateResult.knowledgeBaseReferences.references.length - 1) && <Divider />}
                        </React.Fragment>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {investigateResult.knowledgeBaseReferences?.note || 'No Knowledge Base articles found.'}
                    </Typography>
                  )}
                </Box>
              )}

              {/* Tab 4: Similar Tickets */}
              {investigateTab === 4 && (
                <Box>
                  {(investigateResult.similarOrDuplicateTickets || []).length > 0 ? (
                    <List dense>
                      {(investigateResult.similarOrDuplicateTickets as Array<any>).map((t: any, i: number) => (
                        <React.Fragment key={i}>
                          <ListItem>
                            <ListItemText
                              primary={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                  {t.reference ? (
                                    <Link href={t.reference} target="_blank" rel="noopener" sx={{ fontWeight: 'bold' }}>
                                      {t.ticketKey} <OpenInNew fontSize="inherit" />
                                    </Link>
                                  ) : (
                                    <Typography fontWeight="bold" component="span">{t.ticketKey}</Typography>
                                  )}
                                  <Chip label={`${t.similarityConfidence || 0}%`} size="small" color={scoreColor(t.similarityConfidence || 0)} />
                                  <Chip label={t.status} size="small" variant="outlined" />
                                  {/* Confluence page link */}
                                  {(() => {
                                    const cfl = getConfluenceUrl(t.ticketKey);
                                    if (confluenceLinksLoading && !confluenceLinks[t.ticketKey]) return <CircularProgress size={14} />;
                                    if (!cfl) return null;
                                    return (
                                      <Tooltip title={cfl.title} arrow>
                                        <Link
                                          href={cfl.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          underline="hover"
                                          sx={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 0.4,
                                            fontSize: 12,
                                            fontWeight: 700,
                                            color: cfl.isDirect ? '#1565c0' : '#6a1b9a',
                                            bgcolor: cfl.isDirect ? '#e3f2fd' : '#f3e5f5',
                                            border: `1px solid ${cfl.isDirect ? '#90caf944' : '#ce93d844'}`,
                                            borderRadius: 1,
                                            px: 0.8,
                                            py: 0.2,
                                          }}
                                        >
                                          <MenuBook sx={{ fontSize: 14 }} /> Confluence <OpenInNew sx={{ fontSize: 11 }} />
                                        </Link>
                                      </Tooltip>
                                    );
                                  })()}
                                  <Typography variant="body2" component="span">{t.summary}</Typography>
                                </Box>
                              }
                              secondary={t.resolutionSnippet || ''}
                            />
                          </ListItem>
                          {i < ((investigateResult.similarOrDuplicateTickets || []).length - 1) && <Divider />}
                        </React.Fragment>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="body2" color="text.secondary">No similar tickets found.</Typography>
                  )}
                </Box>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* ═══════════ Similar/Duplicate Tickets ═══════════ */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6">
              Similar/Duplicate Tickets
            </Typography>
            <IconButton size="small" onClick={handleToggleDuplicatePanel}>
              {duplicatePanelExpanded ? <ExpandLess /> : <ExpandMore />}
            </IconButton>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Grouped into duplicate clusters from stored ticket history.
          </Typography>

          <Collapse in={duplicatePanelExpanded}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              <TextField
                size="small"
                placeholder="Search duplicate tickets…"
                value={duplicateSearch}
                onChange={(e) => setDuplicateSearch(e.target.value)}
                sx={{ minWidth: 280 }}
                InputProps={{
                  startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>,
                }}
              />
              <TextField
                select
                size="small"
                label="Priority"
                value={duplicatePriorityFilter}
                onChange={(e) => setDuplicatePriorityFilter(e.target.value)}
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="all">All</MenuItem>
                {duplicatePriorities.map((priority) => (
                  <MenuItem key={priority} value={priority}>{priority}</MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="Component"
                value={duplicateComponentFilter}
                onChange={(e) => setDuplicateComponentFilter(e.target.value)}
                sx={{ minWidth: 190 }}
              >
                <MenuItem value="all">All</MenuItem>
                {duplicateComponents.map((component) => (
                  <MenuItem key={component} value={component}>{component}</MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="Product"
                value={duplicateProductFilter}
                onChange={(e) => setDuplicateProductFilter(e.target.value)}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="all">All</MenuItem>
                {duplicateProducts.map((product) => (
                  <MenuItem key={product} value={product}>{product}</MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="Min confidence"
                value={duplicateMinConfidence}
                onChange={(e) => setDuplicateMinConfidence(e.target.value)}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="40">40%+</MenuItem>
                <MenuItem value="60">60%+</MenuItem>
                <MenuItem value="80">80%+</MenuItem>
              </TextField>
            </Box>

            {defaultDuplicatesLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={22} />
              </Box>
            ) : groupedDuplicateCandidates.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No duplicate-like tickets match the current filters. Fetch tickets first from the Tickets tab if history is empty.
              </Typography>
            ) : (
              <Box>
                {groupedDuplicateCandidates.map(({ group, items }) => (
                  <Box key={group} sx={{ mb: 2.5 }}>
                    {(() => {
                      const [issueType, groupLabel] = group.split(' — ');
                      const issueTypeStyle = getIssueTypeStyle(issueType);
                      const isExpanded = Boolean(expandedDuplicateGroups[group]);
                      return (
                        <>
                          <Box
                            onClick={() => toggleDuplicateGroup(group)}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 1,
                              mb: 0.8,
                              px: 1.25,
                              py: 0.75,
                              borderRadius: 1,
                              border: `1px solid ${issueTypeStyle.color}33`,
                              bgcolor: issueTypeStyle.bg,
                              cursor: 'pointer',
                            }}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                              <Chip
                                size="small"
                                label={issueType}
                                sx={{
                                  bgcolor: issueTypeStyle.bg,
                                  color: issueTypeStyle.color,
                                  fontWeight: 700,
                                  border: `1px solid ${issueTypeStyle.color}44`,
                                }}
                              />
                              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: issueTypeStyle.color }}>
                                {groupLabel || 'Group'}
                              </Typography>
                              <Chip size="small" label={`${items.length} tickets`} sx={{ fontWeight: 700 }} />
                            </Box>
                            {isExpanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                          </Box>
                          <Collapse in={isExpanded}>
                            <List dense>
                              {items.map((c) => {
                                const ticketLink = getTicketLink(c);
                                const normalizedPriority = normalizePriority(c.priority);
                                const normalizedStatus = normalizeStatus(c.status);
                                return (
                                  <Box key={c.ticketKey} sx={{ mb: 1.5 }}>
                                    <ListItem disableGutters>
                                      <ListItemText
                                        primary={
                                          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                                            {ticketLink ? (
                                              <Link href={ticketLink} target="_blank" rel="noreferrer" underline="hover" sx={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                                                {c.ticketKey} <OpenInNew sx={{ fontSize: 14 }} />
                                              </Link>
                                            ) : (
                                              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{c.ticketKey}</Typography>
                                            )}
                                            <Chip size="small" color={scoreColor(c.similarityConfidence) as any} label={`${c.similarityConfidence}% confidence`} />
                                            <Chip
                                              size="small"
                                              label={normalizedStatus.label}
                                              sx={{
                                                bgcolor: normalizedStatus.bg,
                                                color: normalizedStatus.color,
                                                border: `1px solid ${normalizedStatus.color}44`,
                                                fontWeight: 700,
                                              }}
                                            />
                                            <Chip
                                              size="small"
                                              label={normalizedPriority}
                                              sx={{
                                                bgcolor: `${PRIORITY_COLORS[normalizedPriority] || '#9e9e9e'}22`,
                                                color: PRIORITY_COLORS[normalizedPriority] || '#555',
                                                border: `1px solid ${(PRIORITY_COLORS[normalizedPriority] || '#9e9e9e')}55`,
                                                fontWeight: 700,
                                              }}
                                            />
                                            {/* Confluence page link */}
                                            {(() => {
                                              const cfl = getConfluenceUrl(c.ticketKey);
                                              if (confluenceLinksLoading && !confluenceLinks[c.ticketKey]) return <CircularProgress size={14} sx={{ ml: 0.5 }} />;
                                              if (!cfl) return null;
                                              return (
                                                <Tooltip title={cfl.title} arrow>
                                                  <Link
                                                    href={cfl.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    underline="hover"
                                                    sx={{
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: 0.4,
                                                      fontSize: 12,
                                                      fontWeight: 700,
                                                      color: cfl.isDirect ? '#1565c0' : '#6a1b9a',
                                                      bgcolor: cfl.isDirect ? '#e3f2fd' : '#f3e5f5',
                                                      border: `1px solid ${cfl.isDirect ? '#90caf944' : '#ce93d844'}`,
                                                      borderRadius: 1,
                                                      px: 0.8,
                                                      py: 0.2,
                                                    }}
                                                  >
                                                    <MenuBook sx={{ fontSize: 14 }} /> Confluence <OpenInNew sx={{ fontSize: 11 }} />
                                                  </Link>
                                                </Tooltip>
                                              );
                                            })()}
                                          </Box>
                                        }
                                        secondary={
                                          <>
                                            <Typography variant="body2" color="text.secondary">{c.summary || '—'}</Typography>
                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                              Patterns: components [{(c.matchingPatterns.commonComponents || []).join(', ') || 'none'}], labels [{(c.matchingPatterns.commonLabels || []).join(', ') || 'none'}], regression hints [{(c.matchingPatterns.knownRegressionWords || []).join(', ') || 'none'}]
                                            </Typography>
                                            {c.resolutionSnippet && (
                                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                                Resolution: {c.resolutionSnippet}
                                              </Typography>
                                            )}
                                            {c.resolutionNotes && /closed|resolved|done/i.test(c.status || '') && (() => {
                                              const lines = c.resolutionNotes!.split('\n').map((l) => l.trim()).filter(Boolean);
                                              const prLines = lines.filter((l) => l.startsWith('PR/MR:'));
                                              // "Resolution: X" is a label line from the backend
                                              const resolutionLabelLine = lines.find((l) => l.startsWith('Resolution:'));
                                              const resolutionLabel = resolutionLabelLine ? resolutionLabelLine.replace('Resolution:', '').trim() : null;
                                              // Body lines are everything except PR/MR and Resolution: prefix lines
                                              const bodyLines = lines.filter((l) => !l.startsWith('PR/MR:') && !l.startsWith('Resolution:'));
                                              const hasPR = prLines.length > 0;
                                              return (
                                                <Box
                                                  sx={{
                                                    mt: 0.75,
                                                    px: 1.25,
                                                    py: 0.75,
                                                    borderRadius: 1,
                                                    bgcolor: hasPR ? '#e8f5e9' : '#fff8e1',
                                                    border: `1px solid ${hasPR ? '#a5d6a744' : '#ffe08244'}`,
                                                  }}
                                                >
                                                  <Typography variant="caption" sx={{ fontWeight: 700, color: hasPR ? '#2e7d32' : '#e65100', display: 'block', mb: 0.4 }}>
                                                    {hasPR ? '✅ Fix applied:' : '📝 Closure reason:'}
                                                  </Typography>
                                                  {resolutionLabel && (
                                                    <Typography variant="caption" sx={{ display: 'block', fontStyle: 'italic', color: 'text.secondary', mb: 0.25 }}>
                                                      Resolution: {resolutionLabel}
                                                    </Typography>
                                                  )}
                                                  {bodyLines.length > 0 ? (
                                                    bodyLines.map((line, idx) => (
                                                      <Typography key={idx} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                                        {line}
                                                      </Typography>
                                                    ))
                                                  ) : !resolutionLabel ? (
                                                    <Typography variant="caption" color="text.disabled" sx={{ display: 'block', fontStyle: 'italic' }}>
                                                      No closure details found in comments
                                                    </Typography>
                                                  ) : null}
                                                  {prLines.map((prLine, idx) => {
                                                    const urls = prLine.replace('PR/MR:', '').split('|').map((u) => u.trim()).filter(Boolean);
                                                    return (
                                                      <Box key={idx} sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                                        {urls.map((url) => (
                                                          <Link
                                                            key={url}
                                                            href={url}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            underline="hover"
                                                            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, fontSize: 11, fontWeight: 700, color: '#1565c0' }}
                                                          >
                                                            🔗 View PR <OpenInNew sx={{ fontSize: 12 }} />
                                                          </Link>
                                                        ))}
                                                      </Box>
                                                    );
                                                  })}
                                                </Box>
                                              );
                                            })()}
                                          </>
                                        }
                                      />
                                    </ListItem>
                                    <Divider />
                                  </Box>
                                );
                              })}
                            </List>
                          </Collapse>
                        </>
                      );
                    })()}
                  </Box>
                ))}
              </Box>
            )}
          </Collapse>
        </CardContent>
      </Card>

    </Box>
  );
};

export default ResolutionAssistant;
