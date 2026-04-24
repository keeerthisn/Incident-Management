import React, { useEffect, useState, useMemo } from 'react';
import {
  Box, Typography, Card, CardContent, Grid,
  CircularProgress, Button, LinearProgress, TextField, MenuItem, Chip,
  Checkbox, ListItemText, OutlinedInput, Select, InputLabel, FormControl,
} from '@mui/material';
import { Refresh, TableChart, TrendingUp, TrendingDown, PlayArrow, OpenInNew, CheckCircle, AddCircle } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, BarChart, Bar as RechartsBar, XAxis, YAxis, CartesianGrid } from 'recharts';

interface Ticket {
  key: string;
  summary: string;
  priority: string;
  status: string;
  routing_suggestion: string | null;
  confidence_score: number | null;
  severity_score: number | null;
  jira_components: string | null;
  product_name: string | null;
  issue_type: string | null;
  created: string;
  escalation: string | null;
  escalation_notes: string | null;
}

interface JiraSettings {
  projectKey?: string;
  daysBack?: number;
}

// Simple horizontal bar
const Bar: React.FC<{ pct: number; color: string; label: string; count: number; total: number; onClick?: () => void }> = ({ pct, color, label, count, total, onClick }) => (
  <Box sx={{ mb: 1.5 }}>
    <Box
      onClick={onClick}
      sx={{
        display: 'flex', justifyContent: 'space-between', mb: 0.4,
        cursor: onClick ? 'pointer' : 'default',
        '&:hover': onClick ? { '& .bar-label': { color: '#7C3AED' } } : {},
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 500 }} className="bar-label">{label}</Typography>
      <Typography variant="body2" color="text.secondary">{count} <span style={{ color: '#aaa' }}>/ {total}</span></Typography>
    </Box>
    <Box
      onClick={onClick}
      sx={{
        height: 10, bgcolor: 'rgba(0,0,0,0.07)', borderRadius: 5, overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        '&:hover': onClick ? { opacity: 0.8 } : {},
      }}
    >
      <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: color, borderRadius: 5, transition: 'width 0.6s ease' }} />
    </Box>
  </Box>
);

// Tile stat
const StatTile: React.FC<{ label: string; value: string | number; color?: string; onClick?: () => void }> = ({ label, value, color, onClick }) => (
  <Box
    onClick={onClick}
    sx={{
      textAlign: 'center', p: 1.5,
      cursor: onClick ? 'pointer' : 'default',
      borderRadius: 2,
      transition: 'background 0.15s',
      '&:hover': onClick ? { bgcolor: 'rgba(124,58,237,0.07)' } : {},
    }}
  >
    <Typography variant="h5" fontWeight={800} sx={{ color: color || '#5B2D91' }}>{value}</Typography>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    {onClick && <Typography variant="caption" sx={{ display: 'block', color: '#9B6EF3', fontSize: '0.65rem', mt: 0.3 }}>click to filter ›</Typography>}
  </Box>
);

const PRIORITY_COLORS: Record<string, string> = {
  Blocker: '#b71c1c', Critical: '#e65100', Major: '#f57c00', Moderate: '#0288d1', Unset: '#9e9e9e',
};
const STATUS_COLORS = ['#5B2D91', '#7C3AED', '#9B6EF3', '#C4B5FD', '#EDE9FE', '#aaa'];
const ROUTING_COLORS: Record<string, string> = { Engineering: '#5B2D91', Support: '#0288d1', Infrastructure: '#f57c00' };

const PIE_PALETTE = ['#5B2D91', '#d32f2f', '#f57c00', '#0288d1', '#4caf50', '#7C3AED', '#00897b', '#c62828', '#9B6EF3', '#ff7043', '#26a69a', '#ab47bc'];

const RADIAN = Math.PI / 180;
const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.04) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <Box sx={{ bgcolor: '#fff', border: '1px solid #e0e0e0', borderRadius: 1, px: 1.5, py: 0.8, boxShadow: 1 }}>
        <Typography variant="body2" fontWeight={600}>{payload[0].name}</Typography>
        <Typography variant="body2" color="text.secondary">{payload[0].value} ticket{payload[0].value !== 1 ? 's' : ''}</Typography>
      </Box>
    );
  }
  return null;
};

const Analytics: React.FC = () => {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [componentFilter, setComponentFilter] = useState('all');
  const [productFilter, setProductFilter] = useState<string[]>([]);
  const [recentCount, setRecentCount] = useState(10);

  const normalizePriority = (p: string | undefined | null): string => {
    if (!p) return 'Unset';
    const norm = ['Blocker', 'Critical', 'Major', 'Moderate'].find(
      v => v.toLowerCase() === p.toLowerCase()
    );
    return norm || 'Unset';
  };

  let jiraBaseUrl = '';
  let daysBack = 90; // default
  try {
    const js = localStorage.getItem('jiraSettings');
    if (js) {
      const parsed = JSON.parse(js);
      jiraBaseUrl = parsed.url || '';
      daysBack = parsed.daysBack || 90;
    }
  } catch (e) {
    jiraBaseUrl = '';
  }

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    try {
      const raw = localStorage.getItem('jiraSettings');
      if (raw) {
        const settings = JSON.parse(raw) as JiraSettings;
        if (settings.projectKey) params.set('projectKey', settings.projectKey);
        // Don't apply daysBack filter for Analytics - show all tickets
      }
    } catch {
      // keep default unfiltered endpoint
    }

    const query = params.toString();
    const url = query ? `${API_BASE_URL}/api/tickets?${query}` : `${API_BASE_URL}/api/tickets`;

    fetch(url)
      .then(r => r.json())
      .then(d => setTickets(d.tickets || []))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false));
  };

  const runAnalysis = () => {
    setAnalyzing(true);
    fetch(`${API_BASE_URL}/api/analyze-tickets`, { method: 'POST' })
      .then(r => r.json())
      .then(() => load())
      .catch(() => {})
      .finally(() => setAnalyzing(false));
  };

  const syncFromJira = () => {
    setSyncing(true);
    let jiraSettings: any = null;
    try {
      const raw = localStorage.getItem('jiraSettings');
      if (raw) jiraSettings = JSON.parse(raw);
    } catch {}
    if (!jiraSettings?.url || !jiraSettings?.email || !jiraSettings?.apiToken) {
      setSyncing(false);
      navigate('/settings');
      return;
    }
    fetch(`${API_BASE_URL}/api/fetch-tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jiraSettings }),
    })
      .then(r => { if (!r.ok && r.status !== 409) throw new Error(); })
      .then(() => {
        // Poll for completion
        const poll = (count: number) => {
          if (count > 120) { setSyncing(false); return; }
          setTimeout(() => {
            fetch(`${API_BASE_URL}/api/fetch-status`)
              .then(r => r.json())
              .then(status => {
                if (status.done) { load(); setSyncing(false); }
                else poll(count + 1);
              })
              .catch(() => poll(count + 1));
          }, 1500);
        };
        poll(0);
      })
      .catch(() => setSyncing(false));
  };

  useEffect(() => { load(); }, []);

  // Filter logic
  const filtered = useMemo(() => {
    return tickets.filter(t => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && normalizePriority(t.priority) !== priorityFilter) return false;
      if (componentFilter !== 'all') {
        const comps = (t.jira_components || '').split(',').map(c => c.trim());
        if (!comps.includes(componentFilter)) return false;
      }
      if (productFilter.length > 0 && !productFilter.includes(t.product_name || '')) return false;
      return true;
    });
  }, [tickets, statusFilter, priorityFilter, componentFilter, productFilter]);

  // Unique filter values (computed from all tickets, not filtered)
  const uniqueStatuses = useMemo(() => Array.from(new Set(tickets.map(t => t.status))).sort(), [tickets]);
  const uniquePriorities = useMemo(() =>
    Array.from(new Set(tickets.map(t => normalizePriority(t.priority)).filter(p => p !== 'Unset'))).sort(),
  [tickets]);
  const uniqueComponents = useMemo(() =>
    Array.from(new Set(tickets.flatMap(t =>
      t.jira_components ? t.jira_components.split(',').map(c => c.trim()).filter(Boolean) : []
    ))).sort(),
  [tickets]);
  const uniqueProducts = useMemo(() =>
    Array.from(new Set(tickets.map(t => t.product_name).filter(Boolean))).sort() as string[],
  [tickets]);

  // Recently opened tickets (sorted by created date, newest first)
  const recentlyOpenedTickets = useMemo(() => {
    return [...filtered]
      .filter(t => t.created)
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
      .slice(0, recentCount);
  }, [filtered, recentCount]);

  // Recently closed tickets (status is Closed, Resolved, or Done - sorted by created date)
  const recentlyClosedTickets = useMemo(() => {
    const closedStatuses = ['closed', 'resolved', 'done'];
    return [...filtered]
      .filter(t => t.created && closedStatuses.includes((t.status || '').toLowerCase()))
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
      .slice(0, recentCount);
  }, [filtered, recentCount]);

  const hasActiveFilters = statusFilter !== 'all' || priorityFilter !== 'all' || componentFilter !== 'all' || productFilter.length > 0;

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress sx={{ color: '#7C3AED' }} /></Box>;

  if (tickets.length === 0) return (
    <Box>
      <Typography variant="h4" fontWeight={800} gutterBottom>📈 Triage Analytics</Typography>
      <Card sx={{ mt: 4, textAlign: 'center', py: 6 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>No tickets loaded yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Go to Tickets and click Refresh to fetch from Jira.
          </Typography>
          <Button variant="contained" startIcon={<TableChart />} onClick={() => navigate('/tickets')}
            sx={{ background: 'linear-gradient(135deg,#5B2D91,#7C3AED)', borderRadius: 20 }}>
            Go to Tickets
          </Button>
        </CardContent>
      </Card>
    </Box>
  );

  const total = filtered.length;

  // Priority breakdown
  const priorityCounts: Record<string, number> = {};
  filtered.forEach(t => {
    const p = t.priority || 'Unset';
    const norm = ['Blocker','Critical','Major','Moderate'].includes(p) ? p : 'Unset';
    priorityCounts[norm] = (priorityCounts[norm] || 0) + 1;
  });

  // Status breakdown
  const statusCounts: Record<string, number> = {};
  filtered.forEach(t => { const s = t.status || 'Unknown'; statusCounts[s] = (statusCounts[s] || 0) + 1; });

  // Routing breakdown
  const routingCounts: Record<string, number> = {};
  filtered.forEach(t => { if (t.routing_suggestion) { routingCounts[t.routing_suggestion] = (routingCounts[t.routing_suggestion] || 0) + 1; } });

  // Top components
  const compCounts: Record<string, number> = {};
  filtered.forEach(t => {
    if (t.jira_components) {
      t.jira_components.split(',').forEach(c => {
        const trimmed = c.trim();
        if (trimmed) compCounts[trimmed] = (compCounts[trimmed] || 0) + 1;
      });
    }
  });
  const topComponents = Object.entries(compCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const analyzed = filtered.filter(t => t.confidence_score != null).length;
  const unanalyzed = total - analyzed;
  const avgConf = analyzed > 0
    ? Math.round(filtered.filter(t => t.confidence_score != null).reduce((s, t) => s + (t.confidence_score || 0), 0) / analyzed * 100)
    : 0;
  const highPriority = filtered.filter(t => ['Blocker','Critical'].includes(t.priority || '')).length;
  const coveragePct = total > 0 ? Math.round((analyzed / total) * 100) : 0;

  // Severity distribution (buckets based on severity_score)
  const severityBuckets = { Critical: 0, High: 0, Medium: 0, Low: 0, Unscored: 0 };
  filtered.forEach(t => {
    if (t.severity_score == null) { severityBuckets.Unscored++; return; }
    if (t.severity_score >= 0.8) severityBuckets.Critical++;
    else if (t.severity_score >= 0.6) severityBuckets.High++;
    else if (t.severity_score >= 0.4) severityBuckets.Medium++;
    else severityBuckets.Low++;
  });
  const SEVERITY_COLORS: Record<string, string> = {
    Critical: '#d32f2f', High: '#f57c00', Medium: '#0288d1', Low: '#4caf50', Unscored: '#bdbdbd',
  };

  // Confidence score distribution
  const confBuckets = { 'High (≥90%)': 0, 'Good (70-89%)': 0, 'Fair (50-69%)': 0, 'Low (<50%)': 0 };
  filtered.forEach(t => {
    if (t.confidence_score == null) return;
    const pct = t.confidence_score * 100;
    if (pct >= 90) confBuckets['High (≥90%)']++;
    else if (pct >= 70) confBuckets['Good (70-89%)']++;
    else if (pct >= 50) confBuckets['Fair (50-69%)']++;
    else confBuckets['Low (<50%)']++;
  });
  const CONF_COLORS: Record<string, string> = {
    'High (≥90%)': '#4caf50', 'Good (70-89%)': '#0288d1', 'Fair (50-69%)': '#f57c00', 'Low (<50%)': '#d32f2f',
  };

  // Product breakdown
  const productCounts: Record<string, number> = {};
  filtered.forEach(t => {
    const p = t.product_name || 'Unassigned';
    productCounts[p] = (productCounts[p] || 0) + 1;
  });
  const topProducts = Object.entries(productCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const PRODUCT_COLORS = ['#5B2D91', '#0288d1', '#f57c00', '#4caf50', '#d32f2f', '#7C3AED', '#00897b', '#c62828'];

  // Incident category classification (keyword-based, same logic as Grouped Issues)
  const CATEGORY_KEYWORDS: Array<{ label: string; keywords: string[] }> = [
    { label: 'Backup Failures', keywords: ['backup fail', 'backup error', 'failed backup', 'backup unsuccessful'] },
    { label: 'Backup Performance', keywords: ['backup slow', 'backup speed', 'backup throughput', 'backup duration', 'long backup'] },
    { label: 'Backup Management', keywords: ['backup policy', 'backup schedule', 'backup config', 'retention', 'backup plan'] },
    { label: 'Restore / Recovery', keywords: ['restore', 'recovery', 'point-in-time', 'granular restore'] },
    { label: 'Export Issues', keywords: ['export', 'download', 'zip', 'pst'] },
    { label: 'Timeout / Connection', keywords: ['timeout', 'timed out', 'connection', 'disconnect', 'network', 'socket'] },
    { label: 'Authentication / Access', keywords: ['auth', 'login', 'credential', 'password', 'token', 'access denied', 'oauth', 'sso'] },
    { label: 'Storage / Quota', keywords: ['storage', 'quota', 'disk', 'space', 'capacity', 'full'] },
    { label: 'Sync / Replication', keywords: ['sync', 'replication', 'replicate', 'mirror'] },
    { label: 'Email / Exchange', keywords: ['email', 'exchange', 'mailbox', 'outlook', 'smtp'] },
    { label: 'SharePoint / OneDrive', keywords: ['sharepoint', 'onedrive', 'teams', 'm365', 'microsoft 365'] },
    { label: 'UI / Portal', keywords: ['ui', 'portal', 'dashboard', 'console', 'display', 'page'] },
    { label: 'API / Integration', keywords: ['api', 'integration', 'webhook', 'endpoint', 'rest', 'sdk'] },
    { label: 'Performance / Slow', keywords: ['slow', 'performance', 'latency', 'lag', 'degraded', 'high cpu', 'memory'] },
    { label: 'Error / Crash', keywords: ['error', 'crash', 'exception', '500', '503', 'failed'] },
  ];
  const incidentCategoryCounts: Record<string, number> = {};
  filtered.forEach(t => {
    const text = `${t.summary || ''} ${t.jira_components || ''}`.toLowerCase();
    let matched = false;
    for (const cat of CATEGORY_KEYWORDS) {
      if (cat.keywords.some(kw => text.includes(kw))) {
        incidentCategoryCounts[cat.label] = (incidentCategoryCounts[cat.label] || 0) + 1;
        matched = true;
        break;
      }
    }
    if (!matched) {
      incidentCategoryCounts['Other'] = (incidentCategoryCounts['Other'] || 0) + 1;
    }
  });
  const issueTypeData = Object.entries(incidentCategoryCounts).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  const hasIssueTypeData = issueTypeData.length > 0;

  // Pie chart data: components
  const componentPieData = Object.entries(compCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name, value }));

  // Pie chart data: criticality (priority-based)
  const criticalityPieData = ['Blocker', 'Critical', 'Major', 'Moderate', 'Unset']
    .filter(p => (priorityCounts[p] || 0) > 0)
    .map(name => ({ name, value: priorityCounts[name] || 0 }));

  const CRITICALITY_PIE_COLORS: Record<string, string> = {
    Blocker: '#b71c1c', Critical: '#e65100', Major: '#f57c00', Moderate: '#0288d1', Unset: '#bdbdbd',
  };

  // Average severity
  const scored = filtered.filter(t => t.severity_score != null);
  const avgSeverity = scored.length > 0
    ? (scored.reduce((s, t) => s + (t.severity_score || 0), 0) / scored.length)
    : 0;
  const avgSeverityLabel = avgSeverity >= 0.8 ? 'Critical' : avgSeverity >= 0.6 ? 'High' : avgSeverity >= 0.4 ? 'Medium' : 'Low';

  // Trend Analysis: tickets created by year and month (based on daysBack filter)
  const now = new Date();
  
  // Calculate number of months to show based on daysBack setting
  const monthsToShow = Math.max(1, Math.ceil(daysBack / 30));
  
  // Generate months based on daysBack
  const monthsRange: string[] = [];
  for (let i = monthsToShow - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthsRange.push(yearMonth);
  }
  
  // Group tickets by year-month
  const monthlyGroups: Record<string, number> = {};
  // Initialize with 0 for the months in range
  monthsRange.forEach(ym => { monthlyGroups[ym] = 0; });
  // Count tickets (use filtered tickets to reflect applied filters)
  filtered.forEach(t => {
    if (!t.created) return;
    const created = new Date(t.created);
    const yearMonth = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
    if (monthsRange.includes(yearMonth)) {
      monthlyGroups[yearMonth] = (monthlyGroups[yearMonth] || 0) + 1;
    }
  });

  // Sort by year-month and create display data
  const sortedMonths = monthsRange;
  const trendData = sortedMonths.map(yearMonth => {
    const [year, month] = yearMonth.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = monthNames[parseInt(month) - 1];
    const displayName = `${monthName} ${year}`;
    return {
      name: displayName,
      count: monthlyGroups[yearMonth],
      sortKey: yearMonth
    };
  });

  // Calculate total tickets with valid created dates for data availability message
  const ticketsWithDates = tickets.filter(t => t.created).length;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h4" fontWeight={800}>📈 Triage Analytics</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Chip
            label={`Past ${daysBack} days`}
            size="small"
            sx={{ bgcolor: '#ede9fe', color: '#5B2D91', fontWeight: 600 }}
          />
          <Button size="small" startIcon={<Refresh />} onClick={load}
            sx={{ borderRadius: 20, borderColor: '#7C3AED', color: '#7C3AED' }} variant="outlined">
            Refresh
          </Button>
        </Box>
      </Box>

      {/* Filters row */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
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
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="analytics-product-filter-label" shrink>Product</InputLabel>
          <Select
            labelId="analytics-product-filter-label"
            multiple
            displayEmpty
            value={productFilter}
            onChange={e => { setProductFilter(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value); }}
            input={<OutlinedInput notched label="Product" />}
            renderValue={(selected) => selected.length === 0 ? 'All' : selected.join(', ')}
          >
            {uniqueProducts.map(p => (
              <MenuItem key={p} value={p}>
                <Checkbox checked={productFilter.indexOf(p) > -1} size="small" />
                <ListItemText primary={p} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          select size="small" label="Components" sx={{ minWidth: 180 }}
          value={componentFilter} onChange={e => { setComponentFilter(e.target.value); }}
        >
          <MenuItem value="all">All</MenuItem>
          {uniqueComponents.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </TextField>
        {hasActiveFilters && (
          <Chip
            label="Clear filters"
            size="small"
            onClick={() => { setStatusFilter('all'); setPriorityFilter('all'); setComponentFilter('all'); setProductFilter([]); }}
            sx={{ borderColor: '#7C3AED', color: '#7C3AED', alignSelf: 'center' }}
            variant="outlined"
          />
        )}
        {hasActiveFilters && (
          <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
            Showing {filtered.length} of {tickets.length} tickets
          </Typography>
        )}
      </Box>

      {/* Recently Opened / Recently Closed NCIPs */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>Recent NCIPs</Typography>
        <TextField
          select
          size="small"
          label="Show last"
          value={recentCount}
          onChange={e => setRecentCount(Number(e.target.value))}
          sx={{ minWidth: 100 }}
        >
          <MenuItem value={5}>5</MenuItem>
          <MenuItem value={10}>10</MenuItem>
          <MenuItem value={15}>15</MenuItem>
          <MenuItem value={20}>20</MenuItem>
        </TextField>
      </Box>
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {/* Recently Opened */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AddCircle sx={{ color: '#4caf50' }} />
                Recently Opened
              </Typography>
              {recentlyOpenedTickets.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No recently opened tickets.</Typography>
              ) : (
                <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
                  {recentlyOpenedTickets.map(t => (
                    <Box
                      component="li"
                      key={t.key}
                      sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 1,
                        py: 1,
                        borderBottom: '1px solid rgba(0,0,0,0.06)',
                        '&:last-child': { borderBottom: 'none' },
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {jiraBaseUrl ? (
                            <a
                              href={`${jiraBaseUrl.replace(/\/$/, '')}/browse/${t.key}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                              <Typography variant="body2" fontWeight={600} sx={{ color: '#5B2D91' }}>
                                {t.key}
                              </Typography>
                              <OpenInNew sx={{ fontSize: 14, color: '#9B6EF3' }} />
                            </a>
                          ) : (
                            <Typography variant="body2" fontWeight={600} sx={{ color: '#5B2D91' }}>
                              {t.key}
                            </Typography>
                          )}
                          <Chip label={t.status} size="small" sx={{ fontSize: '0.65rem', height: 18 }} />
                        </Box>
                        <Typography variant="body2" color="text.secondary" noWrap title={t.summary}>
                          {t.summary}
                        </Typography>
                        <Typography variant="caption" color="text.disabled">
                          {new Date(t.created).toLocaleDateString()}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Recently Closed */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CheckCircle sx={{ color: '#0288d1' }} />
                Recently Closed
              </Typography>
              {recentlyClosedTickets.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No recently closed tickets.</Typography>
              ) : (
                <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
                  {recentlyClosedTickets.map(t => (
                    <Box
                      component="li"
                      key={t.key}
                      sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 1,
                        py: 1,
                        borderBottom: '1px solid rgba(0,0,0,0.06)',
                        '&:last-child': { borderBottom: 'none' },
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {jiraBaseUrl ? (
                            <a
                              href={`${jiraBaseUrl.replace(/\/$/, '')}/browse/${t.key}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                              <Typography variant="body2" fontWeight={600} sx={{ color: '#5B2D91' }}>
                                {t.key}
                              </Typography>
                              <OpenInNew sx={{ fontSize: 14, color: '#9B6EF3' }} />
                            </a>
                          ) : (
                            <Typography variant="body2" fontWeight={600} sx={{ color: '#5B2D91' }}>
                              {t.key}
                            </Typography>
                          )}
                          <Chip label={t.status} size="small" sx={{ fontSize: '0.65rem', height: 18, bgcolor: '#e3f2fd' }} />
                        </Box>
                        <Typography variant="body2" color="text.secondary" noWrap title={t.summary}>
                          {t.summary}
                        </Typography>
                        <Typography variant="caption" color="text.disabled">
                          {new Date(t.created).toLocaleDateString()}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Summary stat tiles */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ py: 1 }}>
          <Grid container>
            <Grid item xs={6} sm={2.4} sx={{ borderRight: '1px solid rgba(0,0,0,0.08)' }}>
              <StatTile label="Total Tickets" value={total} onClick={() => navigate('/tickets')} />
            </Grid>
            <Grid item xs={6} sm={2.4} sx={{ borderRight: '1px solid rgba(0,0,0,0.08)' }}>
              <StatTile label="High Priority" value={highPriority} color="#d32f2f" onClick={() => navigate('/tickets?highPriority=1')} />
            </Grid>
            <Grid item xs={6} sm={2.4} sx={{ borderRight: '1px solid rgba(0,0,0,0.08)' }}>
              <StatTile label="Analyzed" value={analyzed} color="#5B2D91" onClick={() => navigate('/tickets?analyzed=1')} />
            </Grid>
            <Grid item xs={6} sm={2.4} sx={{ borderRight: '1px solid rgba(0,0,0,0.08)' }}>
              <StatTile label="Avg Confidence" value={analyzed > 0 ? `${avgConf}%` : '--'} color="#0288d1" onClick={() => navigate('/tickets?analyzed=1')} />
            </Grid>
            <Grid item xs={6} sm={2.4}>
              <StatTile label="Avg Severity" value={scored.length > 0 ? avgSeverityLabel : '--'} color={SEVERITY_COLORS[avgSeverityLabel] || '#9e9e9e'} />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Trend Analysis Chart */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TrendingUp sx={{ color: '#5B2D91' }} />
            Monthly Ticket Creation Trends
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            NCIPs created per month
          </Typography>
          {ticketsWithDates === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4 }}>No tickets with creation dates available.</Typography>
          ) : (
            <>
              <Box sx={{ width: '100%', overflowX: 'auto', overflowY: 'hidden' }}>
                <Box sx={{ minWidth: Math.max(600, trendData.length * 80) }}>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={trendData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                      <XAxis 
                        dataKey="name" 
                        tick={{ fill: '#666', fontSize: 11 }}
                        axisLine={{ stroke: '#e0e0e0' }}
                        angle={-45}
                        textAnchor="end"
                        height={70}
                      />
                      <YAxis 
                        tick={{ fill: '#666', fontSize: 12 }}
                        axisLine={{ stroke: '#e0e0e0' }}
                        label={{ value: 'Number of Tickets', angle: -90, position: 'insideLeft', style: { fill: '#666', fontSize: 12 } }}
                      />
                      <RechartsTooltip 
                        content={({ active, payload }: any) => {
                          if (active && payload && payload.length) {
                            return (
                              <Box sx={{ bgcolor: '#fff', border: '1px solid #e0e0e0', borderRadius: 1, px: 1.5, py: 0.8, boxShadow: 1 }}>
                                <Typography variant="body2" fontWeight={600}>{payload[0].payload.name}</Typography>
                                <Typography variant="body2" color="text.secondary">{payload[0].value} tickets</Typography>
                              </Box>
                            );
                          }
                          return null;
                        }}
                      />
                      <RechartsBar 
                        dataKey="count" 
                        fill="#7C3AED" 
                        radius={[8, 8, 0, 0]}
                        label={{ position: 'top', fill: '#5B2D91', fontWeight: 600, fontSize: 11 }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              </Box>
              {trendData.length === 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, textAlign: 'center', fontStyle: 'italic' }}>
                  💡 Tip: To see historical trends, adjust "Fetch Last N Days" in Settings to load older tickets
                </Typography>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Pie Charts Row */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {/* Components Pie */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>Components</Typography>
              {componentPieData.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4 }}>No component data available.</Typography>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={componentPieData}
                      cx="50%" cy="50%"
                      outerRadius={90} innerRadius={35}
                      dataKey="value"
                      labelLine={false}
                      label={renderCustomLabel}
                      stroke="#fff" strokeWidth={2}
                    >
                      {componentPieData.map((_, i) => (
                        <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Criticality Pie */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>Criticality</Typography>
              {criticalityPieData.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4 }}>No priority data.</Typography>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={criticalityPieData}
                      cx="50%" cy="50%"
                      outerRadius={90} innerRadius={35}
                      dataKey="value"
                      labelLine={false}
                      label={renderCustomLabel}
                      stroke="#fff" strokeWidth={2}
                    >
                      {criticalityPieData.map((entry, i) => (
                        <Cell key={i} fill={CRITICALITY_PIE_COLORS[entry.name] || PIE_PALETTE[i % PIE_PALETTE.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Issue Type Pie */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>Incident Categories</Typography>
              {!hasIssueTypeData ? (
                <Box sx={{ textAlign: 'center', mt: 3 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    No tickets loaded yet.
                  </Typography>
                </Box>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={issueTypeData}
                      cx="50%" cy="50%"
                      outerRadius={90} innerRadius={35}
                      dataKey="value"
                      labelLine={false}
                      label={renderCustomLabel}
                      stroke="#fff" strokeWidth={2}
                    >
                      {issueTypeData.map((_, i) => (
                        <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Priority */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>Priority Distribution</Typography>
              {['Blocker','Critical','Major','Moderate','Unset'].map(p => {
                const c = priorityCounts[p] || 0;
                const jql = p === 'Unset' ? 'priority is EMPTY' : `priority = ${p}`;
                return <Bar key={p} label={p} count={c} total={total} pct={total ? (c/total)*100 : 0} color={PRIORITY_COLORS[p] || '#aaa'} onClick={() => jiraBaseUrl && window.open(`${jiraBaseUrl}/issues/?jql=${encodeURIComponent(jql)}`, '_blank')} />;
              })}
            </CardContent>
          </Card>
        </Grid>

        {/* Severity Distribution */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>Severity Distribution</Typography>
              {scored.length === 0
                ? <>
                    <Typography variant="body2" color="text.secondary">Tickets haven't been analyzed yet.</Typography>
                    <Button size="small" variant="contained" startIcon={analyzing ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <PlayArrow />}
                      onClick={runAnalysis} disabled={analyzing}
                      sx={{ mt: 1.5, borderRadius: 20, background: 'linear-gradient(135deg,#5B2D91,#7C3AED)', textTransform: 'none' }}>
                      {analyzing ? 'Analyzing…' : 'Run Analysis'}
                    </Button>
                  </>
                : (['Critical','High','Medium','Low','Unscored'] as const).map(s => {
                    const c = severityBuckets[s];
                    return <Bar key={s} label={s} count={c} total={total} pct={total ? (c/total)*100 : 0} color={SEVERITY_COLORS[s]} />;
                  })
              }
            </CardContent>
          </Card>
        </Grid>

        {/* Status */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>Status Breakdown</Typography>
              {Object.entries(statusCounts).sort((a,b)=>b[1]-a[1]).map(([s, c], i) => (
                <Bar key={s} label={s} count={c} total={total} pct={total ? (c/total)*100 : 0} color={STATUS_COLORS[i % STATUS_COLORS.length]} onClick={() => jiraBaseUrl && window.open(`${jiraBaseUrl}/issues/?jql=${encodeURIComponent(`status = "${s}"`)}`, '_blank')} />
              ))}
            </CardContent>
          </Card>
        </Grid>

        {/* Confidence Score Distribution */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>Confidence Score Breakdown</Typography>
              {analyzed === 0
                ? <>
                    <Typography variant="body2" color="text.secondary">Tickets haven't been analyzed yet.</Typography>
                    <Button size="small" variant="contained" startIcon={analyzing ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <PlayArrow />}
                      onClick={runAnalysis} disabled={analyzing}
                      sx={{ mt: 1.5, borderRadius: 20, background: 'linear-gradient(135deg,#5B2D91,#7C3AED)', textTransform: 'none' }}>
                      {analyzing ? 'Analyzing…' : 'Run Analysis'}
                    </Button>
                  </>
                : Object.entries(confBuckets).map(([label, c]) => (
                    <Bar key={label} label={label} count={c} total={analyzed} pct={analyzed ? (c/analyzed)*100 : 0} color={CONF_COLORS[label] || '#9e9e9e'} />
                  ))
              }
            </CardContent>
          </Card>
        </Grid>

        {/* Routing */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>Team Routing</Typography>
              {Object.keys(routingCounts).length === 0
                ? <>
                    <Typography variant="body2" color="text.secondary">Tickets haven't been analyzed yet.</Typography>
                    <Button size="small" variant="contained" startIcon={analyzing ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <PlayArrow />}
                      onClick={runAnalysis} disabled={analyzing}
                      sx={{ mt: 1.5, borderRadius: 20, background: 'linear-gradient(135deg,#5B2D91,#7C3AED)', textTransform: 'none' }}>
                      {analyzing ? 'Analyzing…' : 'Run Analysis'}
                    </Button>
                  </>
                : Object.entries(routingCounts).sort((a,b)=>b[1]-a[1]).map(([r, c]) => (
                    <Bar key={r} label={r} count={c} total={total} pct={total ? (c/total)*100 : 0} color={ROUTING_COLORS[r] || '#9e9e9e'} />
                  ))
              }
            </CardContent>
          </Card>
        </Grid>

        {/* Product Breakdown */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>Product Breakdown</Typography>
              {topProducts.length === 0
                ? <Typography variant="body2" color="text.secondary">No product data available.</Typography>
                : topProducts.map(([prod, c], i) => (
                    <Bar key={prod} label={prod} count={c} total={total} pct={total ? (c/total)*100 : 0} color={PRODUCT_COLORS[i % PRODUCT_COLORS.length]} />
                  ))
              }
            </CardContent>
          </Card>
        </Grid>

        {/* Top Components */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>Top Components</Typography>
              {topComponents.length === 0
                ? <Typography variant="body2" color="text.secondary">No component data.</Typography>
                : topComponents.map(([comp, c]) => (
                    <Bar key={comp} label={comp} count={c} total={total} pct={total ? (c/total)*100 : 0} color="#7C3AED" />
                  ))
              }
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Analytics;