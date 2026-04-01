import React, { useEffect, useState, useMemo } from 'react';
import {
  Box, Typography, Card, CardContent, Chip, Collapse, IconButton,
  CircularProgress, TextField, InputAdornment, Badge, Tooltip, Link,
  Grid, MenuItem,
} from '@mui/material';
import {
  ExpandMore, ExpandLess, Search, Refresh,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

interface Ticket {
  key: string;
  summary: string;
  status: string;
  priority: string;
  created: string;
  assignee: string;
  jira_components?: string;
  product_name?: string;
}

interface JiraSettings {
  projectKey?: string;
  daysBack?: number;
}

// ── Issue category definitions ──────────────────────────────────────────────
// Each category has a label, colour, icon, and keyword list matched against
// the ticket summary (case-insensitive). Order matters — first match wins.
const CATEGORIES: { label: string; color: string; bg: string; keywords: string[] }[] = [
  {
    label: 'Backup Failures',
    color: '#c62828', bg: '#ffebee',
    keywords: ['backup fail', 'backup error', 'backup unsuccessful', 'backup not complet', 'failed backup', 'backup job fail'],
  },
  {
    label: 'Backup Performance',
    color: '#e65100', bg: '#fff3e0',
    keywords: ['backup slow', 'backup perf', 'backup speed', 'backup duration', 'backup time', 'slow backup', 'backup stuck', 'backup hang'],
  },
  {
    label: 'Backup Management',
    color: '#5B2D91', bg: '#f3e5f5',
    keywords: ['backup manag', 'backup polic', 'backup schedul', 'backup config', 'backup retention', 'backup setup', 'backup plan'],
  },
  {
    label: 'Restore / Recovery',
    color: '#1565c0', bg: '#e3f2fd',
    keywords: ['restor', 'recover', 'granular restore', 'point-in-time', 'recovery'],
  },
  {
    label: 'Export Issues',
    color: '#6a1b9a', bg: '#f3e5f5',
    keywords: ['export', 'download failed', 'download error', 'extract'],
  },
  {
    label: 'Timeout / Connection',
    color: '#e53935', bg: '#fce4ec',
    keywords: ['timeout', 'timed out', 'connection', 'connect fail', 'disconnect', 'network', 'unreachable', 'socket'],
  },
  {
    label: 'Authentication / Access',
    color: '#283593', bg: '#e8eaf6',
    keywords: ['auth', 'login', 'credential', 'password', 'token', 'permission', 'access denied', 'unauthori', 'oauth', 'mfa', '2fa', 'sso'],
  },
  {
    label: 'Storage / Quota',
    color: '#558b2f', bg: '#f1f8e9',
    keywords: ['storage', 'quota', 'disk', 'space', 'capacity', 'full'],
  },
  {
    label: 'Sync / Replication',
    color: '#00695c', bg: '#e0f2f1',
    keywords: ['sync', 'replicat', 'mirror', 'propagat'],
  },
  {
    label: 'Email / Exchange',
    color: '#0277bd', bg: '#e1f5fe',
    keywords: ['email', 'exchange', 'mailbox', 'outlook', 'mail'],
  },
  {
    label: 'SharePoint / OneDrive',
    color: '#01579b', bg: '#e1f5fe',
    keywords: ['sharepoint', 'onedrive', 'one drive', 'teams', 'microsoft 365', 'm365'],
  },
  {
    label: 'UI / Portal',
    color: '#37474f', bg: '#eceff1',
    keywords: ['portal', 'dashboard', 'ui ', 'interface', 'display', 'page not load', 'blank screen', 'render'],
  },
  {
    label: 'Alert / Notification',
    color: '#f57f17', bg: '#fffde7',
    keywords: ['alert', 'notif', 'email alert', 'report'],
  },
  {
    label: 'API / Integration',
    color: '#4527a0', bg: '#ede7f6',
    keywords: ['api', 'integrat', 'webhook', 'endpoint', 'rest', 'sdk'],
  },
  {
    label: 'Performance / Slow',
    color: '#bf360c', bg: '#fbe9e7',
    keywords: ['slow', 'performance', 'latency', 'lag', 'degraded', 'high cpu', 'memory'],
  },
  {
    label: 'Error / Crash',
    color: '#b71c1c', bg: '#ffebee',
    keywords: ['error', 'crash', 'exception', '500', '503', 'critical error'],
  },
];

const PRIORITY_COLORS: Record<string, string> = {
  Blocker: '#d32f2f', Critical: '#d32f2f', Major: '#f57c00', Moderate: '#0288d1',
};

function classifyTicket(ticket: Ticket): string {
  const text = (ticket.summary + ' ' + (ticket.jira_components || '')).toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keywords.some(kw => text.includes(kw))) return cat.label;
  }
  return 'Other';
}

function normalizePriority(raw: string): string {
  if (!raw) return 'Unset';
  const v = raw.trim().toLowerCase();
  if (v === 'undefined' || v === 'unknown' || v === 'none' || v === '' || v === 'unset') return 'Unset';
  if (v === 'blocker') return 'Blocker';
  if (v === 'critical') return 'Critical';
  if (v === 'major') return 'Major';
  if (v === 'moderate') return 'Moderate';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

const GroupedIssues: React.FC = () => {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [componentFilter, setComponentFilter] = useState('all');

  const jiraBaseUrl = (() => {
    try { return JSON.parse(localStorage.getItem('jiraSettings') || '{}').url?.replace(/\/$/, '') || ''; }
    catch { return ''; }
  })();

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
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
      // keep default unfiltered endpoint
    }

    const query = params.toString();
    const url = query ? `http://localhost:8000/api/tickets?${query}` : 'http://localhost:8000/api/tickets';

    fetch(url)
      .then(r => r.json())
      .then(d => setTickets(d.tickets || []))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter(t => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && normalizePriority(t.priority) !== priorityFilter) return false;
      if (componentFilter !== 'all') {
        const comps = (t.jira_components || '').split(',').map(c => c.trim());
        if (!comps.includes(componentFilter)) return false;
      }
      if (q) {
        return (
          t.summary.toLowerCase().includes(q) ||
          t.key.toLowerCase().includes(q) ||
          (t.jira_components || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [tickets, search, statusFilter, priorityFilter, componentFilter]);

  const uniqueStatuses = useMemo(() => Array.from(new Set(tickets.map(t => t.status))).sort(), [tickets]);
  const uniquePriorities = useMemo(() =>
    Array.from(new Set(tickets.map(t => normalizePriority(t.priority)).filter(p => p !== 'Unset'))).sort(),
  [tickets]);
  const uniqueComponents = useMemo(() =>
    Array.from(new Set(tickets.flatMap(t =>
      t.jira_components ? t.jira_components.split(',').map(c => c.trim()).filter(Boolean) : []
    ))).sort(),
  [tickets]);

  // Group tickets
  const groups = useMemo(() => {
    const map: Record<string, Ticket[]> = {};
    for (const t of filtered) {
      const cat = classifyTicket(t);
      if (!map[cat]) map[cat] = [];
      map[cat].push(t);
    }
    // Sort groups: defined categories first (in order), then Other
    const defined = CATEGORIES.map(c => c.label).filter(l => map[l]);
    const result: { label: string; tickets: Ticket[] }[] = defined.map(l => ({ label: l, tickets: map[l] }));
    if (map['Other']) result.push({ label: 'Other', tickets: map['Other'] });
    return result;
  }, [filtered]);

  const toggleGroup = (label: string) =>
    setExpanded(e => ({ ...e, [label]: !e[label] }));

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    groups.forEach(g => { all[g.label] = true; });
    setExpanded(all);
  };

  const collapseAll = () => setExpanded({});

  const getCatMeta = (label: string) =>
    CATEGORIES.find(c => c.label === label) || { color: '#607d8b', bg: '#eceff1', label: 'Other', keywords: [] };

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
      <CircularProgress sx={{ color: '#7C3AED' }} />
    </Box>
  );

  if (tickets.length === 0) return (
    <Box>
      <Typography variant="h4" fontWeight={800} gutterBottom>🗂️ Grouped Issues</Typography>
      <Card sx={{ mt: 4, textAlign: 'center', py: 6 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>No tickets loaded yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Go to Tickets and click Refresh to pull from Jira.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h4" fontWeight={800}>🗂️ Grouped Issues</Typography>
          <Typography variant="body2" color="text.secondary">
            {filtered.length} tickets across {groups.length} categories
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Typography
            variant="caption" onClick={expandAll}
            sx={{ cursor: 'pointer', color: '#7C3AED', textDecoration: 'underline', userSelect: 'none' }}
          >Expand all</Typography>
          <Typography variant="caption" color="text.secondary">·</Typography>
          <Typography
            variant="caption" onClick={collapseAll}
            sx={{ cursor: 'pointer', color: '#7C3AED', textDecoration: 'underline', userSelect: 'none' }}
          >Collapse all</Typography>
          <IconButton size="small" onClick={load} sx={{ color: '#7C3AED' }}>
            <Refresh fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {/* Filters row */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <TextField
          select size="small" label="Status" sx={{ minWidth: 140 }}
          value={statusFilter} onChange={e => { setStatusFilter(e.target.value); }}
        >
          <MenuItem value="all">All</MenuItem>
          {uniqueStatuses.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
        </TextField>
        <TextField
          select size="small" label="Priority" sx={{ minWidth: 140 }}
          value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); }}
        >
          <MenuItem value="all">All</MenuItem>
          {uniquePriorities.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
        </TextField>
        <TextField
          select size="small" label="Components" sx={{ minWidth: 180 }}
          value={componentFilter} onChange={e => { setComponentFilter(e.target.value); }}
        >
          <MenuItem value="all">All</MenuItem>
          {uniqueComponents.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </TextField>
        {(statusFilter !== 'all' || priorityFilter !== 'all' || componentFilter !== 'all') && (
          <Chip
            label="Clear filters"
            size="small"
            onClick={() => { setStatusFilter('all'); setPriorityFilter('all'); setComponentFilter('all'); }}
            sx={{ alignSelf: 'center', cursor: 'pointer', bgcolor: '#f3e5f5', color: '#5B2D91' }}
          />
        )}
      </Box>

      {/* Search */}
      <TextField
        size="small"
        placeholder="Search tickets…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        sx={{ mb: 3, width: 320 }}
        InputProps={{
          startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>,
        }}
      />

      {/* Category summary pills */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
        {groups.map(g => {
          const meta = getCatMeta(g.label);
          return (
            <Chip
              key={g.label}
              label={`${g.label} (${g.tickets.length})`}
              onClick={() => setExpanded(e => ({ ...e, [g.label]: true }))}
              size="small"
              sx={{
                bgcolor: meta.bg,
                color: meta.color,
                fontWeight: 600,
                border: `1px solid ${meta.color}30`,
                fontSize: '0.72rem',
                cursor: 'pointer',
              }}
            />
          );
        })}
      </Box>

      {/* Group cards */}
      {groups.map(g => {
        const meta = getCatMeta(g.label);
        const isOpen = !!expanded[g.label];
        const highCount = g.tickets.filter(t => ['Blocker','Critical'].includes(normalizePriority(t.priority))).length;

        return (
          <Card
            key={g.label}
            sx={{ mb: 2, border: `1.5px solid ${meta.color}30`, borderLeft: `4px solid ${meta.color}` }}
            elevation={0}
          >
            {/* Group header — click to expand */}
            <Box
              onClick={() => toggleGroup(g.label)}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                px: 2.5, py: 1.5, cursor: 'pointer', bgcolor: meta.bg,
                '&:hover': { filter: 'brightness(0.97)' },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography fontWeight={700} sx={{ color: meta.color }}>
                  {g.label}
                </Typography>
                <Badge
                  badgeContent={g.tickets.length}
                  sx={{ '& .MuiBadge-badge': { bgcolor: meta.color, color: '#fff', fontWeight: 700 } }}
                >
                  <Box sx={{ width: 8 }} />
                </Badge>
                {highCount > 0 && (
                  <Chip
                    label={`${highCount} high priority`}
                    size="small"
                    sx={{ bgcolor: '#ffebee', color: '#c62828', fontWeight: 600, fontSize: '0.68rem', height: 20 }}
                  />
                )}
              </Box>
              <IconButton size="small" sx={{ color: meta.color }}>
                {isOpen ? <ExpandLess /> : <ExpandMore />}
              </IconButton>
            </Box>

            <Collapse in={isOpen} unmountOnExit>
              <CardContent sx={{ pt: 1, pb: 1.5 }}>
                <Grid container spacing={0}>
                  {g.tickets.map((t, i) => {
                    const p = normalizePriority(t.priority);
                    const priorityColor = PRIORITY_COLORS[p];
                    return (
                      <Grid item xs={12} key={t.key}>
                        <Box
                          sx={{
                            display: 'flex', alignItems: 'flex-start', gap: 1.5,
                            py: 0.9, px: 1,
                            borderBottom: i < g.tickets.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none',
                            '&:hover': { bgcolor: 'rgba(0,0,0,0.02)', borderRadius: 1 },
                          }}
                        >
                          {/* Jira key link */}
                          <Typography
                            variant="caption"
                            fontWeight={700}
                            sx={{ minWidth: 100, color: '#5B2D91', whiteSpace: 'nowrap', pt: 0.1 }}
                          >
                            {jiraBaseUrl ? (
                              <Link
                                href={`${jiraBaseUrl}/browse/${t.key}`}
                                target="_blank"
                                rel="noreferrer"
                                underline="hover"
                                sx={{ color: '#5B2D91' }}
                              >
                                {t.key}
                              </Link>
                            ) : t.key}
                          </Typography>

                          {/* Summary */}
                          <Typography variant="body2" sx={{ flexGrow: 1, lineHeight: 1.4 }}>
                            {t.summary}
                          </Typography>

                          {/* Right side metadata */}
                          <Box sx={{ display: 'flex', gap: 0.8, alignItems: 'center', flexShrink: 0 }}>
                            {/* Status */}
                            <Chip
                              label={t.status}
                              size="small"
                              sx={{ height: 20, fontSize: '0.65rem', bgcolor: '#e3f2fd', color: '#1565c0' }}
                            />
                            {/* Priority */}
                            {p !== 'Unset' && (
                              <Chip
                                label={p}
                                size="small"
                                sx={{
                                  height: 20, fontSize: '0.65rem',
                                  bgcolor: priorityColor ? `${priorityColor}18` : '#f5f5f5',
                                  color: priorityColor || '#555',
                                  border: `1px solid ${priorityColor || '#ccc'}40`,
                                }}
                              />
                            )}
                            {/* Component */}
                            {t.jira_components && (
                              <Tooltip title={t.jira_components} arrow>
                                <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 120 }}>
                                  {t.jira_components.split(',')[0].trim()}
                                </Typography>
                              </Tooltip>
                            )}
                          </Box>
                        </Box>
                      </Grid>
                    );
                  })}
                </Grid>
              </CardContent>
            </Collapse>
          </Card>
        );
      })}
    </Box>
  );
};

export default GroupedIssues;
