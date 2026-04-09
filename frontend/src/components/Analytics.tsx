import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Grid,
  CircularProgress, Button, LinearProgress,
} from '@mui/material';
import { Refresh, TableChart, TrendingUp, TrendingDown, PlayArrow } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';

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

  let jiraBaseUrl = '';
  try {
    const js = localStorage.getItem('jiraSettings');
    if (js) {
      const parsed = JSON.parse(js);
      jiraBaseUrl = parsed.url || '';
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
        if (settings.daysBack && Number.isFinite(settings.daysBack)) {
          params.set('daysBack', String(settings.daysBack));
        }
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

  const total = tickets.length;

  // Priority breakdown
  const priorityCounts: Record<string, number> = {};
  tickets.forEach(t => {
    const p = t.priority || 'Unset';
    const norm = ['Blocker','Critical','Major','Moderate'].includes(p) ? p : 'Unset';
    priorityCounts[norm] = (priorityCounts[norm] || 0) + 1;
  });

  // Status breakdown
  const statusCounts: Record<string, number> = {};
  tickets.forEach(t => { const s = t.status || 'Unknown'; statusCounts[s] = (statusCounts[s] || 0) + 1; });

  // Routing breakdown
  const routingCounts: Record<string, number> = {};
  tickets.forEach(t => { if (t.routing_suggestion) { routingCounts[t.routing_suggestion] = (routingCounts[t.routing_suggestion] || 0) + 1; } });

  // Top components
  const compCounts: Record<string, number> = {};
  tickets.forEach(t => {
    if (t.jira_components) {
      t.jira_components.split(',').forEach(c => {
        const trimmed = c.trim();
        if (trimmed) compCounts[trimmed] = (compCounts[trimmed] || 0) + 1;
      });
    }
  });
  const topComponents = Object.entries(compCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const analyzed = tickets.filter(t => t.confidence_score != null).length;
  const unanalyzed = total - analyzed;
  const avgConf = analyzed > 0
    ? Math.round(tickets.filter(t => t.confidence_score != null).reduce((s, t) => s + (t.confidence_score || 0), 0) / analyzed * 100)
    : 0;
  const highPriority = tickets.filter(t => ['Blocker','Critical'].includes(t.priority || '')).length;
  const coveragePct = total > 0 ? Math.round((analyzed / total) * 100) : 0;

  // Severity distribution (buckets based on severity_score)
  const severityBuckets = { Critical: 0, High: 0, Medium: 0, Low: 0, Unscored: 0 };
  tickets.forEach(t => {
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
  tickets.forEach(t => {
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
  tickets.forEach(t => {
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
  tickets.forEach(t => {
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
  const scored = tickets.filter(t => t.severity_score != null);
  const avgSeverity = scored.length > 0
    ? (scored.reduce((s, t) => s + (t.severity_score || 0), 0) / scored.length)
    : 0;
  const avgSeverityLabel = avgSeverity >= 0.8 ? 'Critical' : avgSeverity >= 0.6 ? 'High' : avgSeverity >= 0.4 ? 'Medium' : 'Low';

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4" fontWeight={800}>📈 Triage Analytics</Typography>
        <Button size="small" startIcon={<Refresh />} onClick={load}
          sx={{ borderRadius: 20, borderColor: '#7C3AED', color: '#7C3AED' }} variant="outlined">
          Refresh
        </Button>
      </Box>

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

      {/* Triage Coverage Banner */}
      <Card sx={{ mb: 3, background: coveragePct === 100 ? 'linear-gradient(135deg, #e8f5e9, #f1f8e9)' : coveragePct >= 50 ? 'linear-gradient(135deg, #fff3e0, #fff8e1)' : 'linear-gradient(135deg, #ffebee, #fce4ec)' }}>
        <CardContent sx={{ py: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {coveragePct >= 70 ? <TrendingUp sx={{ color: '#4caf50' }} /> : <TrendingDown sx={{ color: '#f57c00' }} />}
              <Typography variant="subtitle1" fontWeight={700}>Triage Coverage</Typography>
            </Box>
            <Typography variant="h5" fontWeight={800} sx={{ color: coveragePct >= 70 ? '#2e7d32' : coveragePct >= 50 ? '#e65100' : '#c62828' }}>
              {coveragePct}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={coveragePct}
            sx={{
              height: 8, borderRadius: 4, mb: 1,
              backgroundColor: 'rgba(0,0,0,0.1)',
              '& .MuiLinearProgress-bar': {
                borderRadius: 4,
                background: coveragePct >= 70 ? 'linear-gradient(90deg,#4caf50,#66bb6a)' : coveragePct >= 50 ? 'linear-gradient(90deg,#f57c00,#ffb74d)' : 'linear-gradient(90deg,#d32f2f,#ef5350)',
              }
            }}
          />
          <Typography variant="body2" color="text.secondary">
            {analyzed} of {total} tickets analyzed · {unanalyzed > 0 ? `${unanalyzed} remaining` : 'All tickets triaged!'}
          </Typography>
          {unanalyzed > 0 && (
            <Button size="small" variant="outlined" onClick={runAnalysis} disabled={analyzing}
              startIcon={analyzing ? <CircularProgress size={14} /> : <PlayArrow />}
              sx={{ mt: 1, borderRadius: 20, borderColor: '#7C3AED', color: '#7C3AED', fontSize: '0.75rem' }}>
              {analyzing ? 'Analyzing…' : 'Analyze Remaining Tickets'}
            </Button>
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