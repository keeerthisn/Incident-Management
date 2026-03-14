import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Grid,
  CircularProgress, Chip, Button, Tooltip,
} from '@mui/material';
import { Refresh, TableChart } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

interface Ticket {
  key: string;
  priority: string;
  status: string;
  routing_suggestion: string | null;
  confidence_score: number | null;
  severity_score: number | null;
  jira_components: string | null;
  product_name: string | null;
}

// Simple horizontal bar
const Bar: React.FC<{ pct: number; color: string; label: string; count: number; total: number }> = ({ pct, color, label, count, total }) => (
  <Box sx={{ mb: 1.5 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>{label}</Typography>
      <Typography variant="body2" color="text.secondary">{count} <span style={{ color: '#aaa' }}>/ {total}</span></Typography>
    </Box>
    <Box sx={{ height: 10, bgcolor: 'rgba(0,0,0,0.07)', borderRadius: 5, overflow: 'hidden' }}>
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
  Blocker: '#d32f2f', Critical: '#d32f2f', Major: '#f57c00', Moderate: '#0288d1', Unset: '#9e9e9e',
};
const STATUS_COLORS = ['#5B2D91', '#7C3AED', '#9B6EF3', '#C4B5FD', '#EDE9FE', '#aaa'];
const ROUTING_COLORS: Record<string, string> = { Engineering: '#5B2D91', Support: '#0288d1', Infrastructure: '#f57c00' };

const Analytics: React.FC = () => {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch('http://localhost:8000/api/tickets')
      .then(r => r.json())
      .then(d => setTickets(d.tickets || []))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false));
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
  const avgConf = analyzed > 0
    ? Math.round(tickets.filter(t => t.confidence_score != null).reduce((s, t) => s + (t.confidence_score || 0), 0) / analyzed * 100)
    : 0;
  const highPriority = tickets.filter(t => ['Blocker','Critical'].includes(t.priority || '')).length;

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
            <Grid item xs={6} sm={3} sx={{ borderRight: '1px solid rgba(0,0,0,0.08)' }}>
              <StatTile label="Total Tickets" value={total} onClick={() => navigate('/tickets')} />
            </Grid>
            <Grid item xs={6} sm={3} sx={{ borderRight: '1px solid rgba(0,0,0,0.08)' }}>
              <StatTile label="High Priority" value={highPriority} color="#d32f2f" onClick={() => navigate('/tickets?highPriority=1')} />
            </Grid>
            <Grid item xs={6} sm={3} sx={{ borderRight: '1px solid rgba(0,0,0,0.08)' }}>
              <StatTile label="Analyzed" value={analyzed} color="#5B2D91" onClick={() => navigate('/tickets?analyzed=1')} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <StatTile label="Avg Confidence" value={analyzed > 0 ? `${avgConf}%` : '--'} color="#0288d1" onClick={() => navigate('/tickets?analyzed=1')} />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Grid container spacing={3}>
        {/* Priority */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>Priority Distribution</Typography>
              {['Blocker','Critical','Major','Moderate','Unset'].map(p => {
                const c = priorityCounts[p] || 0;
                return <Bar key={p} label={p} count={c} total={total} pct={total ? (c/total)*100 : 0} color={PRIORITY_COLORS[p] || '#aaa'} />;
              })}
            </CardContent>
          </Card>
        </Grid>

        {/* Status */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>Status Breakdown</Typography>
              {Object.entries(statusCounts).sort((a,b)=>b[1]-a[1]).map(([s, c], i) => (
                <Bar key={s} label={s} count={c} total={total} pct={total ? (c/total)*100 : 0} color={STATUS_COLORS[i % STATUS_COLORS.length]} />
              ))}
            </CardContent>
          </Card>
        </Grid>

        {/* Routing */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>Team Routing</Typography>
              {Object.keys(routingCounts).length === 0
                ? <Typography variant="body2" color="text.secondary">Run analysis to see routing.</Typography>
                : Object.entries(routingCounts).sort((a,b)=>b[1]-a[1]).map(([r, c]) => (
                    <Bar key={r} label={r} count={c} total={total} pct={total ? (c/total)*100 : 0} color={ROUTING_COLORS[r] || '#9e9e9e'} />
                  ))
              }
              {Object.keys(routingCounts).length === 0 && (
                <Button size="small" variant="outlined" onClick={() => navigate('/tickets')}
                  sx={{ mt: 1, borderRadius: 20, borderColor: '#7C3AED', color: '#7C3AED' }}>
                  Go to Tickets → Run Analysis
                </Button>
              )}
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

        {/* All tickets chip cloud */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>All Tickets by Priority</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
                {tickets.map(t => {
                  const norm = ['Blocker','Critical','Major','Moderate'].includes(t.priority || '') ? t.priority : 'Unset';
                  return (
                    <Tooltip key={t.key} title={t.status} arrow>
                      <Chip
                        label={t.key}
                        size="small"
                        onClick={() => navigate('/tickets')}
                        sx={{
                          fontSize: '0.70rem',
                          bgcolor: norm !== 'Unset' ? PRIORITY_COLORS[norm!] : '#e0e0e0',
                          color: norm !== 'Unset' ? '#fff' : '#555',
                          cursor: 'pointer',
                          '&:hover': { opacity: 0.8 },
                        }}
                      />
                    </Tooltip>
                  );
                })}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Analytics;