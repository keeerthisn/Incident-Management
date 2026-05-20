import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Grid,
  Alert,
  Paper,
  CircularProgress,
  LinearProgress,
} from '@mui/material';
import { PlayArrow, GetApp, Settings as SettingsIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';

interface JiraSettings {
  url: string;
  email: string;
  apiToken: string;
  projectKey: string;
  daysBack?: number;
  jql?: string;
}

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [fetchingTickets, setFetchingTickets] = useState(false);
  const [jiraConfigured, setJiraConfigured] = useState(false);
  const [ticketCount, setTicketCount] = useState(0);
  const [topHighPriorityTicket, setTopHighPriorityTicket] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState({ open: 0, highPriority: 0, unassigned: 0, components: 0 });
  const [showConnectedAlert, setShowConnectedAlert] = useState(true);
  const connectedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [fetchElapsed, setFetchElapsed] = useState(0);
  const fetchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Check if Jira is configured
  const checkJiraConfiguration = () => {
    const savedSettings = localStorage.getItem('jiraSettings');
    if (savedSettings) {
      try {
        const settings: JiraSettings = JSON.parse(savedSettings);
        const isConfigured = settings.url && settings.email && settings.apiToken;
        setJiraConfigured(!!isConfigured);
        
        // Also check if we have stored tickets
        const storedTickets = localStorage.getItem('ticketCount');
        if (storedTickets) {
          setTicketCount(parseInt(storedTickets) || 0);
        }
      } catch (error) {
        console.error('Error parsing Jira settings:', error);
        setJiraConfigured(false);
      }
    } else {
      setJiraConfigured(false);
    }
  };
  
  useEffect(() => {
    checkJiraConfiguration();
    // Auto-dismiss the "Jira Connected" banner after 5 seconds
    connectedTimerRef.current = setTimeout(() => setShowConnectedAlert(false), 5000);
    // Load live stats from stored tickets (filtered by configured scope)
    let ticketsUrl = `${API_BASE_URL}/api/tickets`;
    try {
      const savedSettings = localStorage.getItem('jiraSettings');
      if (savedSettings) {
        const settings: JiraSettings = JSON.parse(savedSettings);
        const params = new URLSearchParams();
        if (settings.projectKey) params.set('projectKey', settings.projectKey);
        if (settings.daysBack && Number.isFinite(settings.daysBack)) params.set('daysBack', String(settings.daysBack));
        if (params.toString()) ticketsUrl += `?${params.toString()}`;
      }
    } catch {
      // Keep unfiltered endpoint as fallback
    }

    fetch(ticketsUrl)
      .then(r => r.json())
      .then(d => {
        const t = d.tickets || [];
        const normalizePriority = (raw: string) => {
          if (!raw) return 'unset';
          const v = raw.trim().toLowerCase();
          if (v === '1' || v.startsWith('1 -') || v.startsWith('1-')) return 'blocker';
          if (v === '2' || v.startsWith('2 -') || v.startsWith('2-')) return 'critical';
          return v;
        };
        const openStatuses = ['open','in progress','in-progress','new','to do','todo','reopened'];
        const open = t.filter((x: any) => openStatuses.includes((x.status || '').toLowerCase())).length;
        const highPriorityTickets = t.filter((x: any) => ['blocker', 'critical'].includes(normalizePriority(x.priority || '')));
        const highPriority = highPriorityTickets.length;
        const unassigned = t.filter((x: any) => !x.assignee || x.assignee === 'unassigned').length;
        const compSet = new Set(t.flatMap((x: any) =>
          x.jira_components ? x.jira_components.split(',').map((c: string) => c.trim()).filter(Boolean) : []
        ));
        setTicketCount(t.length);
        localStorage.setItem('ticketCount', String(t.length));
        setLiveStats({ open, highPriority, unassigned, components: compSet.size });
        setTopHighPriorityTicket(highPriorityTickets[0]?.key || null);
      })
      .catch(() => {});
    return () => { if (connectedTimerRef.current) clearTimeout(connectedTimerRef.current); };
  }, []);
  
  // Listen for storage changes (when settings are saved)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'jiraSettings') {
        checkJiraConfiguration();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    // Also check when component becomes visible (tab focus)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkJiraConfiguration();
      }
    };
    
    // Listen for custom jira settings update event
    const handleJiraSettingsUpdate = () => {
      checkJiraConfiguration();
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('jiraSettingsUpdated', handleJiraSettingsUpdate);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('jiraSettingsUpdated', handleJiraSettingsUpdate);
    };
  }, []);
  
  const fetchTicketsFromJira = async () => {
    setFetchingTickets(true);
    setFetchError(null);
    setFetchElapsed(0);
    fetchTimerRef.current = setInterval(() => setFetchElapsed(prev => prev + 1), 1000);
    
    try {
      // Read saved Jira credentials from localStorage
      const savedSettings = localStorage.getItem('jiraSettings');
      const jiraSettings = savedSettings ? JSON.parse(savedSettings) : null;
      
      const body = jiraSettings?.url && jiraSettings?.email && jiraSettings?.apiToken
        ? { jiraSettings }
        : {};
      
      // Fire the fetch — returns immediately (background task)
      const response = await fetch(`${API_BASE_URL}/api/fetch-tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const startData = await response.json().catch(() => null);

      if (!response.ok && response.status !== 409) {
        const detail = (startData && (startData.detail || startData.message)) || null;
        throw new Error(detail || `Server error: ${response.status}`);
      }

      // If backend returned demo/sample data directly (no Jira creds)
      if (startData?.tickets && startData.tickets.length > 0) {
        setTicketCount(startData.count || 0);
        localStorage.setItem('ticketCount', (startData.count || 0).toString());
        setFetchError(null);
        return;
      }

      // Poll /api/fetch-status until done
      let pollCount = 0;
      const maxPolls = 300; // 5 minutes at 1s intervals
      while (pollCount < maxPolls) {
        await new Promise(r => setTimeout(r, 1000));
        pollCount++;
        try {
          const statusResp = await fetch(`${API_BASE_URL}/api/fetch-status`);
          const status = await statusResp.json();
          
          // Update progress display with live ticket count
          if (status.tickets_so_far > 0) {
            setTicketCount(status.tickets_so_far);
          }

          if (status.done) {
            if (status.error) {
              throw new Error(status.error);
            }
            const result = status.result || {};
            setTicketCount(result.count || status.tickets_so_far || 0);
            localStorage.setItem('ticketCount', String(result.count || status.tickets_so_far || 0));
            setFetchError(null);

            // Refresh live stats
            try {
              let statsUrl = `${API_BASE_URL}/api/tickets`;
              const savedS = localStorage.getItem('jiraSettings');
              if (savedS) {
                const s = JSON.parse(savedS);
                const p = new URLSearchParams();
                if (s.projectKey) p.set('projectKey', s.projectKey);
                if (s.daysBack && Number.isFinite(s.daysBack)) p.set('daysBack', String(s.daysBack));
                if (p.toString()) statsUrl += `?${p.toString()}`;
              }
              const statsResp = await fetch(statsUrl);
              const statsData = await statsResp.json();
              const t = statsData.tickets || [];
              const normalizePriority = (raw: string) => {
                if (!raw) return 'unset';
                const v = raw.trim().toLowerCase();
                if (v === '1' || v.startsWith('1 -') || v.startsWith('1-')) return 'blocker';
                if (v === '2' || v.startsWith('2 -') || v.startsWith('2-')) return 'critical';
                return v;
              };
              const openStatuses = ['open','in progress','in-progress','new','to do','todo','reopened'];
              const open = t.filter((x: any) => openStatuses.includes((x.status || '').toLowerCase())).length;
              const highPriorityTickets = t.filter((x: any) => ['blocker', 'critical'].includes(normalizePriority(x.priority || '')));
              const highPriority = highPriorityTickets.length;
              const unassigned = t.filter((x: any) => !x.assignee || x.assignee === 'unassigned').length;
              const compSet = new Set(t.flatMap((x: any) =>
                x.jira_components ? x.jira_components.split(',').map((c: string) => c.trim()).filter(Boolean) : []
              ));
              setTicketCount(t.length);
              localStorage.setItem('ticketCount', String(t.length));
              setLiveStats({ open, highPriority, unassigned, components: compSet.size });
              setTopHighPriorityTicket(highPriorityTickets[0]?.key || null);
            } catch { /* stats refresh is best-effort */ }
            return;
          }
        } catch (pollErr) {
          // Transient poll failure — keep trying
          console.warn('fetch-status poll error:', pollErr);
        }
      }
      // If we exit the loop, it timed out
      setFetchError('Fetch took too long (>5 minutes). Check backend logs.');
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        setFetchError(`Cannot reach backend (${API_BASE_URL}). Start the backend server first.`);
      } else {
        setFetchError(error instanceof Error ? error.message : 'Failed to fetch tickets');
      }
    } finally {
      abortRef.current = null;
      setFetchingTickets(false);
      if (fetchTimerRef.current) { clearInterval(fetchTimerRef.current); fetchTimerRef.current = null; }
    }
  };

  const cancelFetch = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  };

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        🎯 NCIP Triage Dashboard
      </Typography>

      {!jiraConfigured ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          <strong>Welcome to your NCIP Manager!</strong> 
          To get started, configure your Jira connection in Settings.
        </Alert>
      ) : showConnectedAlert ? (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setShowConnectedAlert(false)}>
          <strong>Jira Connected!</strong>{' '}
          You can now fetch tickets and run triage analysis.
        </Alert>
      ) : null}
      
      {fetchError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          <strong>Error:</strong> {fetchError}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Quick Setup Guide */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                🚀 Quick Setup Guide
              </Typography>
              
              <Box sx={{ mt: 2 }}>
                <Paper sx={{ p: 2, mb: 2, bgcolor: 'primary.50' }}>
                  <Typography variant="subtitle1" fontWeight="bold" color="primary">
                    Step 1: Configure Jira Connection
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 2 }}>
                    Set up your Jira API credentials to fetch NCIP tickets
                  </Typography>
                  <Button 
                    variant="contained" 
                    startIcon={<SettingsIcon />}
                    onClick={() => navigate('/settings')}
                  >
                    Go to Settings
                  </Button>
                </Paper>
                
                <Paper sx={{ p: 2, mb: 2, bgcolor: jiraConfigured ? 'success.50' : 'grey.50' }}>
                  <Typography 
                    variant="subtitle1" 
                    fontWeight="bold"
                    color={jiraConfigured ? 'success.main' : 'text.primary'}
                  >
                    Step 2: Fetch Recent Tickets
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 2 }}>
                    Import NCIP tickets from your Jira project
                  </Typography>
                  <Button 
                    variant={jiraConfigured ? "contained" : "outlined"}
                    color={jiraConfigured ? "success" : "inherit"}
                    startIcon={fetchingTickets ? <CircularProgress size={20} /> : <GetApp />}
                    disabled={!jiraConfigured || fetchingTickets}
                    onClick={fetchTicketsFromJira}
                  >
                    {fetchingTickets 
                      ? `Fetching... ${ticketCount > 0 ? `${ticketCount} tickets` : ''} ${fetchElapsed}s` 
                      : jiraConfigured 
                        ? `Fetch from Jira${ticketCount > 0 ? ` (${ticketCount} loaded)` : ''}` 
                        : 'Configure Jira first'
                    }
                  </Button>
                  {fetchingTickets && (
                    <>
                      <Button
                        variant="text"
                        color="error"
                        size="small"
                        onClick={cancelFetch}
                        sx={{ ml: 1 }}
                      >
                        Cancel
                      </Button>
                      <LinearProgress sx={{ mt: 1, borderRadius: 1 }} />
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                        Fetching tickets from Jira... This may take up to a minute for large projects.
                      </Typography>
                    </>
                  )}
                </Paper>
                
                <Paper sx={{ p: 2, bgcolor: (jiraConfigured && ticketCount > 0) ? 'primary.50' : 'grey.50' }}>
                  <Typography 
                    variant="subtitle1" 
                    fontWeight="bold"
                    color={(jiraConfigured && ticketCount > 0) ? 'primary.main' : 'text.primary'}
                  >
                    Step 3: Run Triage Analysis
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 2 }}>
                    Automatically categorize and route tickets
                  </Typography>
                  <Button 
                    variant={(jiraConfigured && ticketCount > 0) ? "contained" : "outlined"}
                    startIcon={<PlayArrow />}
                    disabled={!jiraConfigured || ticketCount === 0}
                    onClick={() => navigate('/tickets')}
                  >
                    {!jiraConfigured 
                      ? 'Configure Jira first'
                      : ticketCount === 0
                        ? 'Fetch tickets first'
                        : `Analyze ${ticketCount} tickets`
                    }
                  </Button>
                </Paper>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Status Cards */}
        <Grid item xs={12}>
          <Grid container spacing={2}>
            <Grid item xs={12} md={3}>
              <Card sx={{ cursor: 'pointer', '&:hover': { boxShadow: 3 } }} onClick={() => navigate('/tickets')}>
                <CardContent>
                  <Typography variant="h6" color="primary">{ticketCount}</Typography>
                  <Typography variant="body2">Total Tickets</Typography>
                  <Typography variant="caption" color="text.secondary">All fetched from Jira</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <Card sx={{ cursor: 'pointer', '&:hover': { boxShadow: 3 } }} onClick={() => navigate('/tickets?status=open')}>
                <CardContent>
                  <Typography variant="h6" sx={{ color: '#2e7d32' }}>{liveStats.open}</Typography>
                  <Typography variant="body2">Open / In Progress</Typography>
                  <Typography variant="caption" color="text.secondary">Tickets still active</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <Card sx={{ cursor: 'pointer', '&:hover': { boxShadow: 3 } }} onClick={() => navigate('/tickets?highPriority=1')}>
                <CardContent>
                  <Typography variant="h6" color="error">{liveStats.highPriority}</Typography>
                  <Typography variant="body2">High Priority</Typography>
                  <Typography variant="caption" color="text.secondary">Blocker + Critical</Typography>
                  <Box sx={{ mt: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!topHighPriorityTicket}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!topHighPriorityTicket) return;
                        navigate(`/root-cause-analyzer?ticket=${encodeURIComponent(topHighPriorityTicket)}`);
                      }}
                    >
                      Analyze in Root Cause
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <Card sx={{ cursor: 'pointer', '&:hover': { boxShadow: 3 } }} onClick={() => navigate('/grouped')}>
                <CardContent>
                  <Typography variant="h6" sx={{ color: '#7C3AED' }}>{liveStats.components}</Typography>
                  <Typography variant="body2">Components</Typography>
                  <Typography variant="caption" color="text.secondary">Distinct Jira components</Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;