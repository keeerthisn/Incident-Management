import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Alert,
  Button,
  Grid,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TablePagination,
  TableSortLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress,
  Link,
  TextField,
  MenuItem,
  Snackbar,
  Checkbox,
  ListItemText,
  OutlinedInput,
  Select,
  InputLabel,
  FormControl,
  Tooltip,
  Popover,
} from '@mui/material';
import { 
  Settings as SettingsIcon, 
  ExpandMore, 
  Refresh,
  Psychology,
  LinkOutlined,
} from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';

interface LinkedIssue {
  key: string;
  summary: string;
  status: string;
  type: string;
  linkType: string;
}

interface Ticket {
  key: string;
  summary: string;
  status: string;
  priority: string;
  created: string;
  assignee: string;
  description: string;
  jira_components?: string;
  product_name?: string;
  component?: string;
  severity_score?: number;
  routing_suggestion?: string;
  confidence_score?: number;
  escalation?: string;
  escalation_notes?: string;
  linked_issues?: LinkedIssue[];
  crm_id?: string;
}

const TicketList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [productFilter, setProductFilter] = useState<string[]>([]);
  const [componentFilter, setComponentFilter] = useState<string>('all');
  const [showAnalyzedOnly, setShowAnalyzedOnly] = useState(false);
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [sortColumn, setSortColumn] = useState<string>('created');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [linksPopoverAnchor, setLinksPopoverAnchor] = useState<HTMLElement | null>(null);
  const [linksPopoverTicket, setLinksPopoverTicket] = useState<Ticket | null>(null);

  // Apply URL query param filters on first mount (from Analytics deep-links)
  useEffect(() => {
    if (searchParams.get('highPriority') === '1') setPriorityFilter('HighPriority');
    if (searchParams.get('analyzed') === '1') setShowAnalyzedOnly(true);
    if (searchParams.get('unassigned') === '1') setShowUnassignedOnly(true);
    const p = searchParams.get('priority');
    if (p) setPriorityFilter(p);
    const s = searchParams.get('status');
    if (s) setStatusFilter(s);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      setSortDir('asc');
    }
    setPage(0);
  };

  const colValue = (t: Ticket, col: string): string | number => {
    switch (col) {
      case 'key':        return t.key ?? '';
      case 'sf_id':      return t.crm_id ?? '';
      case 'product':    return t.product_name ?? '';
      case 'summary':    return t.summary ?? '';
      case 'status':     return t.status ?? '';
      case 'priority':   return t.priority ?? '';
      case 'escalation': return t.escalation ?? '';
      case 'assignee':   return t.assignee ?? '';
      case 'created':    return t.created ?? '';
      default:           return '';
    }
  };

  const getJiraSettingsFromStorage = () => {
    try {
      const raw = localStorage.getItem('jiraSettings');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const buildTicketsUrl = () => {
    const jiraSettings = getJiraSettingsFromStorage();
    const params = new URLSearchParams();

    if (jiraSettings?.projectKey) {
      params.set('projectKey', jiraSettings.projectKey);
    }

    if (jiraSettings?.daysBack && Number.isFinite(jiraSettings.daysBack)) {
      params.set('daysBack', String(jiraSettings.daysBack));
    }

    const query = params.toString();
    return query
      ? `${API_BASE_URL}/api/tickets?${query}`
      : `${API_BASE_URL}/api/tickets`;
  };

  // Always reads stored tickets from DB (fast, used internally)
  const loadStoredTickets = async () => {
    const response = await fetch(buildTicketsUrl());
    if (!response.ok) throw new Error(`Server error: ${response.status}`);
    const data = await response.json();
    const loadedTickets = data.tickets || [];
    setTickets(loadedTickets);
    setPage(0);
    // Keep localStorage ticketCount in sync so Dashboard shows the correct total
    localStorage.setItem('ticketCount', String(loadedTickets.length));
  };

  // Initial load — just read DB
  const fetchTickets = async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      await loadStoredTickets();
    } catch (err) {
      if (err instanceof TypeError && (err as TypeError).message.includes('fetch')) {
        setError(`Cannot reach backend (${API_BASE_URL}). Is it running?`);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load tickets');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Refresh button: re-fetch from Jira then reload DB tickets
  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const jiraSettings = getJiraSettingsFromStorage();
      if (jiraSettings?.url && jiraSettings?.email && jiraSettings?.apiToken) {
        // Start background fetch
        const fetchResp = await fetch(`${API_BASE_URL}/api/fetch-tickets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jiraSettings }),
        });
        if (!fetchResp.ok && fetchResp.status !== 409) {
          const errData = await fetchResp.json().catch(() => ({}));
          throw new Error(errData.detail || `Jira fetch failed: ${fetchResp.status}`);
        }

        // Poll for completion
        let pollCount = 0;
        const maxPolls = 300;
        while (pollCount < maxPolls) {
          await new Promise(r => setTimeout(r, 1000));
          pollCount++;
          try {
            const statusResp = await fetch(`${API_BASE_URL}/api/fetch-status`);
            const status = await statusResp.json();
            if (status.done) {
              if (status.error) throw new Error(status.error);
              await loadStoredTickets();
              const result = status.result || {};
              const mode = result.mode === 'incremental' ? 'Updated' : 'Refreshed';
              const elapsed = result.elapsed_seconds ? ` in ${result.elapsed_seconds}s` : '';
              setSnackbar({ open: true, message: `${mode} — ${result.count ?? 'all'} tickets in database${elapsed}`, severity: 'success' });
              break;
            }
          } catch (pollErr) {
            if (pollCount >= maxPolls) throw pollErr;
          }
        }
      } else {
        // No Jira settings, just reload DB
        await loadStoredTickets();
        setSnackbar({ open: true, message: 'Reloaded tickets from local database', severity: 'success' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Refresh failed';
      setError(msg);
      setSnackbar({ open: true, message: msg, severity: 'error' });
    } finally {
      setRefreshing(false);
    }
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/analyze-tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Analysis failed: ${response.status}`);
      const result = await response.json();
      // Reload tickets to surface updated analysis fields
      await loadStoredTickets();
      setSnackbar({ open: true, message: `Triage complete — ${result.analyzed_count ?? 'all'} tickets analyzed`, severity: 'success' });
    } catch (err) {
      const msg = err instanceof TypeError && (err as TypeError).message.includes('fetch')
        ? 'Cannot reach backend. Is it running?'
        : err instanceof Error ? err.message : 'Analysis failed';
      setError(msg);
      setSnackbar({ open: true, message: msg, severity: 'error' });
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  // Normalise an NCI Severity string into a clean display label.
  // NCI Severity levels: Blocker > Critical > Major > Moderate
  // "Undefined" is a legitimate Jira value meaning severity not yet assessed.
  const normalizePriority = (raw: string): string => {
    if (!raw) return 'Unset';
    const v = raw.trim().toLowerCase();
    if (v === 'undefined' || v === 'unknown' || v === 'none' || v === '') return 'Unset';
    if (v === 'blocker')  return 'Blocker';
    if (v === 'critical') return 'Critical';
    if (v === 'major')    return 'Major';
    if (v === 'moderate') return 'Moderate';
    // Legacy numeric NCI levels
    if (v === '1' || v.startsWith('1 -') || v.startsWith('1-')) return 'Blocker';
    if (v === '2' || v.startsWith('2 -') || v.startsWith('2-')) return 'Critical';
    if (v === '3' || v.startsWith('3 -') || v.startsWith('3-')) return 'Major';
    if (v === '4' || v.startsWith('4 -') || v.startsWith('4-')) return 'Moderate';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  };

  const getPriorityColor = (priority: string): 'error' | 'warning' | 'info' | 'success' | 'default' => {
    switch (normalizePriority(priority)) {
      case 'Blocker':  return 'error';
      case 'Critical': return 'error';
      case 'Major':    return 'warning';
      case 'Moderate': return 'info';
      default:         return 'default';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'open': case 'new': return 'error';
      case 'in progress': case 'investigating': return 'warning';
      case 'resolved': case 'closed': return 'success';
      default: return 'default';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString()
  };

  const isJiraConfigured = () => {
    try {
      const savedSettings = localStorage.getItem('jiraSettings');
      if (!savedSettings) return false;
      const settings = JSON.parse(savedSettings) as {
        url?: string;
        email?: string;
        apiToken?: string;
      };
      return Boolean(settings.url && settings.email && settings.apiToken);
    } catch {
      return false;
    }
  };

  const jiraConfigured = isJiraConfigured();

  const uniqueStatuses = Array.from(new Set(tickets.map(t => t.status))).sort();
  const uniquePriorities = Array.from(
    new Set(
      tickets
        .map(t => normalizePriority(t.priority))
        .filter(v => v !== 'Unset')
    )
  ).sort();
  const uniqueProducts = Array.from(
    new Set(
      tickets
        .map(t => t.product_name)
        .filter((p): p is string => Boolean(p))
    )
  ).sort();
  const uniqueComponents = Array.from(
    new Set(
      tickets.flatMap(t =>
        t.jira_components
          ? t.jira_components.split(',').map(c => c.trim()).filter(Boolean)
          : []
      )
    )
  ).sort();

  const filteredTickets = tickets.filter((t) => {
    return (
      (statusFilter === 'all' || t.status === statusFilter) &&
      (priorityFilter === 'all' || 
        (priorityFilter === 'HighPriority'
          ? ['Blocker','Critical'].includes(normalizePriority(t.priority))
          : normalizePriority(t.priority) === priorityFilter)) &&
      (productFilter.length === 0 || productFilter.includes(t.product_name || '')) &&
      (componentFilter === 'all' || (
        t.jira_components
          ? t.jira_components.split(',').map(c => c.trim()).includes(componentFilter)
          : false
      )) &&
      (!showAnalyzedOnly || !!t.routing_suggestion) &&
      (!showUnassignedOnly || t.assignee === 'unassigned')
    );
  });

  const sortedTickets = [...filteredTickets].sort((a, b) => {
    const av = colValue(a, sortColumn);
    const bv = colValue(b, sortColumn);
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const paginatedTickets = sortedTickets.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (tickets.length === 0) {
    return (
      <Box>
        <Typography variant="h4" component="h1" gutterBottom>
          Incident Tickets
        </Typography>

        <Alert severity="info" sx={{ mb: 3 }}>
          <strong>No tickets found.</strong>{' '}
          {jiraConfigured
            ? 'No issues match your current filter yet. Fetch from Jira on the Dashboard or adjust your JQL in Settings.'
            : 'Configure your Jira connection and fetch tickets to get started.'}
        </Alert>

        {jiraConfigured ? (
          <Card>
            <CardContent sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="h6" gutterBottom>
                Ready to Import Tickets?
              </Typography>
              <Typography variant="body2" color="textSecondary" paragraph>
                Your Jira connection is set up. Fetch tickets from the Dashboard or refine your JQL filter in Settings.
              </Typography>
              <Button
                variant="contained"
                onClick={() => navigate('/')}
                size="large"
              >
                Go to Dashboard
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="h6" gutterBottom>
                Ready to Import Tickets? 
              </Typography>
              <Typography variant="body2" color="textSecondary" paragraph>
                Connect to your Jira instance to automatically fetch and analyze incident tickets.
              </Typography>
              <Button 
                variant="contained" 
                startIcon={<SettingsIcon />}
                onClick={() => navigate('/settings')}
                size="large"
              >
                Configure Jira Connection
              </Button>
            </CardContent>
          </Card>
        )}
      </Box>
    );
  }

  const jiraBaseUrl = (getJiraSettingsFromStorage()?.url || '').replace(/\/+$/, '');
  const daysBack = getJiraSettingsFromStorage()?.daysBack || 30;

  const clearAllFilters = () => {
    setStatusFilter('all');
    setPriorityFilter('all');
    setProductFilter([]);
    setComponentFilter('all');
    setShowAnalyzedOnly(false);
    setShowUnassignedOnly(false);
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          Incident Tickets ({filteredTickets.length}/{tickets.length})
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Chip
            label={`Past ${daysBack} days`}
            size="small"
            sx={{ bgcolor: '#ede9fe', color: '#5B2D91', fontWeight: 600 }}
          />
          <Button
            variant="outlined"
            startIcon={refreshing ? <CircularProgress size={18} /> : <Refresh />}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </Box>
      </Box>

      {/* Filters */}
      <Box display="flex" flexWrap="wrap" gap={2} mb={2}>
        <TextField
          select
          label="Status"
          size="small"
          sx={{ minWidth: 140 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <MenuItem value="all">All</MenuItem>
          {uniqueStatuses.map((s) => (
            <MenuItem key={s} value={s}>{s}</MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Priority"
          size="small"
          sx={{ minWidth: 140 }}
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
        >
          <MenuItem value="all">All</MenuItem>
          {uniquePriorities.map((p) => (
            <MenuItem key={p} value={p}>{p}</MenuItem>
          ))}
        </TextField>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="ticket-product-filter-label" shrink>Product</InputLabel>
          <Select
            labelId="ticket-product-filter-label"
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
          select
          label="Components"
          size="small"
          sx={{ minWidth: 180 }}
          value={componentFilter}
          onChange={(e) => setComponentFilter(e.target.value)}
        >
          <MenuItem value="all">All</MenuItem>
          {uniqueComponents.map((c) => (
            <MenuItem key={c} value={c}>{c}</MenuItem>
          ))}
        </TextField>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Summary Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={3}>
          <Card onClick={clearAllFilters} sx={{ cursor: 'pointer' }}>
            <CardContent>
              <Typography color="primary" variant="h6">
                {tickets.length}
              </Typography>
              <Typography variant="body2">Total Tickets</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Card
            onClick={() => {
              setPriorityFilter('HighPriority');
              setShowAnalyzedOnly(false);
              setShowUnassignedOnly(false);
            }}
            sx={{ cursor: 'pointer' }}
          >
            <CardContent>
              <Typography color="error" variant="h6">
                {tickets.filter(t => ['Blocker','Critical'].includes(normalizePriority(t.priority) || '')).length}
              </Typography>
              <Typography variant="body2">High Priority</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Card
            onClick={() => {
              setShowAnalyzedOnly(true);
              setShowUnassignedOnly(false);
            }}
            sx={{ cursor: 'pointer' }}
          >
            <CardContent>
              <Typography color="success.main" variant="h6">
                {tickets.filter(t => t.routing_suggestion).length}
              </Typography>
              <Typography variant="body2">Analyzed</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Card
            onClick={() => {
              setShowUnassignedOnly(true);
              setShowAnalyzedOnly(false);
            }}
            sx={{ cursor: 'pointer' }}
          >
            <CardContent>
              <Typography color="warning.main" variant="h6">
                {tickets.filter(t => t.assignee === 'unassigned').length}
              </Typography>
              <Typography variant="body2">Unassigned</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tickets Table */}
      <TableContainer component={Paper} sx={{ width: '100%', overflowX: 'auto' }}>
        <Table size="small" sx={{ tableLayout: 'fixed', width: '100%' }}>
          <TableHead>
            <TableRow>
              {([
                { id: 'key',      label: 'Jira ID',    width: '7%'  },
                { id: 'sf_id',    label: 'SF ID',      width: '8%'  },
                { id: 'summary',  label: 'Summary',    width: '22%' },
                { id: 'product',  label: 'Product',    width: '9%' },
                { id: 'status',   label: 'Status',     width: '7%' },
                { id: 'priority', label: 'Priority',   width: '7%' },
                { id: 'escalation', label: 'Escalated', width: '7%' },
                { id: 'links',    label: 'Linked Issues', width: '9%' },
                { id: 'assignee', label: 'Assignee',   width: '10%' },
                { id: 'created',  label: 'Created',    width: '14%' },
              ] as { id: string; label: string; width: string }[]).map(col => (
                <TableCell
                  key={col.id}
                  sortDirection={sortColumn === col.id ? sortDir : false}
                  sx={{ width: col.width, py: 1, px: 1.5, whiteSpace: 'nowrap' }}
                >
                  <TableSortLabel
                    active={sortColumn === col.id}
                    direction={sortColumn === col.id ? sortDir : 'asc'}
                    onClick={() => handleSort(col.id)}
                    sx={{
                      color: '#FFFFFF !important',
                      '& .MuiTableSortLabel-icon': { color: '#FFFFFF !important', opacity: 0.7 },
                      '&.Mui-active': { color: '#FFFFFF !important' },
                      '&.Mui-active .MuiTableSortLabel-icon': { opacity: 1 },
                    }}
                  >
                    {col.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedTickets.map((ticket) => (
              <React.Fragment key={ticket.key}>
                <TableRow hover>
                  <TableCell sx={{ py: 0.8, px: 1.5, overflow: 'hidden' }}>
                    <Typography variant="subtitle2" fontWeight="bold" noWrap>
                      {jiraBaseUrl ? (
                        <Link
                          href={`${jiraBaseUrl}/browse/${ticket.key}`}
                          target="_blank"
                          rel="noreferrer"
                          underline="hover"
                        >
                          {ticket.key}
                        </Link>
                      ) : (
                        ticket.key
                      )}
                    </Typography>
                    <Button
                      size="small"
                      onClick={() => navigate(`/root-cause-analyzer?ticket=${encodeURIComponent(ticket.key)}`)}
                      sx={{ mt: 0.5, p: 0, minWidth: 'auto', textTransform: 'none' }}
                    >
                      Analyze
                    </Button>
                  </TableCell>
                  <TableCell sx={{ py: 0.8, px: 1.5, overflow: 'hidden' }}>
                    {ticket.crm_id ? (
                      <Tooltip title={ticket.crm_id} arrow>
                        <Link
                          href={`https://n-able.lightning.force.com/lightning/r/Case/${ticket.crm_id}/view`}
                          target="_blank"
                          rel="noreferrer"
                          underline="hover"
                          sx={{ fontSize: '0.8rem' }}
                        >
                          {ticket.crm_id.length > 18 ? `${ticket.crm_id.substring(0, 15)}...` : ticket.crm_id}
                        </Link>
                      </Tooltip>
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ py: 0.8, px: 1.5, overflow: 'hidden' }}>
                    <Accordion elevation={0}>
                      <AccordionSummary
                        expandIcon={<ExpandMore fontSize="small" />}
                        sx={{ p: 0, minHeight: 'unset' }}
                      >
                        <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                          {ticket.summary}
                        </Typography>
                      </AccordionSummary>
                      <AccordionDetails sx={{ p: 1, pt: 0 }}>
                        <Typography variant="body2" color="textSecondary">
                          <strong>Description:</strong><br />
                          {ticket.description || 'No description available'}
                        </Typography>
                      </AccordionDetails>
                    </Accordion>
                  </TableCell>
                  <TableCell sx={{ py: 0.8, px: 1.5, overflow: 'hidden' }}>
                    <Typography variant="body2" noWrap>
                      {ticket.product_name || '—'}
                    </Typography>
                    {ticket.jira_components && (
                      <Typography variant="caption" color="textSecondary" noWrap display="block" title={ticket.jira_components}>
                        Components: {ticket.jira_components}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ py: 0.8, px: 1.5 }}>
                    <Chip 
                      label={ticket.status} 
                      color={getStatusColor(ticket.status) as any}
                      size="small" 
                    />
                  </TableCell>
                  <TableCell sx={{ py: 0.8, px: 1.5 }}>
                    <Chip
                      label={normalizePriority(ticket.priority)}
                      color={getPriorityColor(ticket.priority) as any}
                      size="small"
                      variant={normalizePriority(ticket.priority) === 'Unset' ? 'outlined' : 'filled'}
                    />
                  </TableCell>
                  <TableCell sx={{ py: 0.8, px: 1.5 }}>
                    {ticket.escalation ? (
                      <Chip
                        label={ticket.escalation}
                        size="small"
                        sx={{
                          bgcolor: ticket.escalation === 'Yes' || ticket.escalation === 'Critical' ? '#b71c1c' :
                                   ticket.escalation === 'High' ? '#e65100' :
                                   ticket.escalation === 'Medium' ? '#f57c00' : 
                                   ticket.escalation === 'No' ? '#4caf50' : '#9e9e9e',
                          color: '#fff',
                          fontWeight: 600,
                        }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ py: 0.8, px: 1.5 }}>
                    {ticket.linked_issues && ticket.linked_issues.length > 0 ? (
                      <Chip
                        label={`${ticket.linked_issues.length}`}
                        size="small"
                        icon={<LinkOutlined sx={{ fontSize: 14 }} />}
                        onClick={(e) => {
                          setLinksPopoverAnchor(e.currentTarget);
                          setLinksPopoverTicket(ticket);
                        }}
                        sx={{
                          cursor: 'pointer',
                          bgcolor: 'rgba(25, 118, 210, 0.1)',
                          color: '#1976d2',
                          border: '1px solid rgba(25, 118, 210, 0.3)',
                          '&:hover': { bgcolor: 'rgba(25, 118, 210, 0.2)' },
                        }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ py: 0.8, px: 1.5 }}>
                    <Typography variant="body2" noWrap title={ticket.assignee}>
                      {ticket.assignee === 'unassigned' ? '—' : ticket.assignee}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 0.8, px: 1.5 }}>
                    <Typography variant="body2" noWrap>
                      {formatDate(ticket.created)}
                    </Typography>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={filteredTickets.length}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(parseInt(event.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </TableContainer>

      {/* Success / error snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar(s => ({ ...s, open: false }))}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      {/* Linked Issues Popover */}
      <Popover
        open={Boolean(linksPopoverAnchor)}
        anchorEl={linksPopoverAnchor}
        onClose={() => {
          setLinksPopoverAnchor(null);
          setLinksPopoverTicket(null);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, minWidth: 350, maxWidth: 500 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5, color: '#1976d2' }}>
            <LinkOutlined sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'middle' }} />
            Linked Issues for {linksPopoverTicket?.key}
          </Typography>
          {linksPopoverTicket?.linked_issues && linksPopoverTicket.linked_issues.length > 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {linksPopoverTicket.linked_issues.map((link, idx) => (
                <Box 
                  key={idx} 
                  sx={{ 
                    p: 1.5, 
                    bgcolor: '#f5f5f5', 
                    borderRadius: 1,
                    border: '1px solid #e0e0e0',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Chip 
                      label={link.linkType} 
                      size="small" 
                      sx={{ 
                        fontSize: '0.7rem', 
                        height: 20,
                        bgcolor: '#e3f2fd',
                        color: '#1565c0',
                      }} 
                    />
                    <Link
                      href={jiraBaseUrl ? `${jiraBaseUrl}/browse/${link.key}` : '#'}
                      target="_blank"
                      rel="noreferrer"
                      underline="hover"
                      sx={{ fontWeight: 700, fontSize: '0.875rem' }}
                    >
                      {link.key}
                    </Link>
                    {link.type && (
                      <Chip 
                        label={link.type} 
                        size="small" 
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 18 }} 
                      />
                    )}
                  </Box>
                  <Typography variant="body2" sx={{ mb: 0.5, color: '#333' }}>
                    {link.summary}
                  </Typography>
                  <Chip
                    label={link.status}
                    size="small"
                    sx={{
                      fontSize: '0.7rem',
                      height: 20,
                      bgcolor: link.status === 'Done' || link.status === 'Resolved' || link.status === 'Closed' ? '#c8e6c9' :
                               link.status === 'In Progress' ? '#fff3e0' : '#e0e0e0',
                      color: link.status === 'Done' || link.status === 'Resolved' || link.status === 'Closed' ? '#2e7d32' :
                             link.status === 'In Progress' ? '#e65100' : '#616161',
                    }}
                  />
                </Box>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">No linked issues</Typography>
          )}
        </Box>
      </Popover>
    </Box>
  );
};

export default TicketList;