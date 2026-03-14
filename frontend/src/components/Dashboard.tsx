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
} from '@mui/material';
import { PlayArrow, GetApp, Settings as SettingsIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

interface JiraSettings {
  url: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [fetchingTickets, setFetchingTickets] = useState(false);
  const [jiraConfigured, setJiraConfigured] = useState(false);
  const [ticketCount, setTicketCount] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState({ open: 0, highPriority: 0, unassigned: 0, components: 0 });
  const [showConnectedAlert, setShowConnectedAlert] = useState(true);
  const connectedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  
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
    // Load live stats from stored tickets
    fetch('http://localhost:8000/api/tickets')
      .then(r => r.json())
      .then(d => {
        const t = d.tickets || [];
        const openStatuses = ['open','in progress','in-progress','new','to do','todo','reopened'];
        const open = t.filter((x: any) => openStatuses.includes((x.status || '').toLowerCase())).length;
        const highPriority = t.filter((x: any) => ['Blocker','Critical'].includes(x.priority || '')).length;
        const unassigned = t.filter((x: any) => !x.assignee || x.assignee === 'unassigned').length;
        const compSet = new Set(t.flatMap((x: any) =>
          x.jira_components ? x.jira_components.split(',').map((c: string) => c.trim()).filter(Boolean) : []
        ));
        setTicketCount(t.length);
        setLiveStats({ open, highPriority, unassigned, components: compSet.size });
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
    
    // Abort controller so we can cancel or timeout after 15s
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    try {
      // Read saved Jira credentials from localStorage
      const savedSettings = localStorage.getItem('jiraSettings');
      const jiraSettings = savedSettings ? JSON.parse(savedSettings) : null;
      
      const body = jiraSettings?.url && jiraSettings?.email && jiraSettings?.apiToken
        ? { jiraSettings }
        : {};
      
      const response = await fetch('http://localhost:8000/api/fetch-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const detail = (data && (data.detail || data.message)) || null;
        const message = detail
          ? `Server error: ${detail}`
          : `Server error: ${response.status} ${response.statusText}`;
        throw new Error(message);
      }
      
      setTicketCount(data.count || 0);
      localStorage.setItem('ticketCount', (data.count || 0).toString());
      setFetchError(null);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        setFetchError('Request timed out after 15 seconds. Is the backend running?');
      } else if (error instanceof TypeError && error.message.includes('fetch')) {
        setFetchError('Cannot reach backend (http://localhost:8000). Start the backend server first.');
      } else {
        setFetchError(error instanceof Error ? error.message : 'Failed to fetch tickets');
      }
    } finally {
      abortRef.current = null;
      setFetchingTickets(false);
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
        🎯 Incident Triage Dashboard
      </Typography>

      {!jiraConfigured ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          <strong>Welcome to your Incident Triage Tool!</strong> 
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
        <Grid item xs={12} md={8}>
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
                    Set up your Jira API credentials to fetch incident tickets
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
                    Import incident tickets from your Jira project
                  </Typography>
                  <Button 
                    variant={jiraConfigured ? "contained" : "outlined"}
                    color={jiraConfigured ? "success" : "inherit"}
                    startIcon={fetchingTickets ? <CircularProgress size={20} /> : <GetApp />}
                    disabled={!jiraConfigured || fetchingTickets}
                    onClick={fetchTicketsFromJira}
                  >
                    {fetchingTickets 
                      ? 'Fetching...' 
                      : jiraConfigured 
                        ? `Fetch from Jira${ticketCount > 0 ? ` (${ticketCount} loaded)` : ''}` 
                        : 'Configure Jira first'
                    }
                  </Button>
                  {fetchingTickets && (
                    <Button
                      variant="text"
                      color="error"
                      size="small"
                      onClick={cancelFetch}
                      sx={{ ml: 1 }}
                    >
                      Cancel
                    </Button>
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

        {/* Features Overview */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                ✨ Key Features
              </Typography>
              
              <Box sx={{ mt: 2 }}>
                {[
                  { icon: '🎯', title: 'Smart Classification', desc: 'Auto-categorize by component and severity', path: '/tickets' },
                  { icon: '🚀', title: 'Intelligent Routing', desc: 'Route to Support or Engineering teams', path: '/tickets' },
                  { icon: '📊', title: 'Triage Dashboard', desc: 'Pre-meeting summaries and insights', path: '/analytics' },
                  { icon: '📈', title: 'Analytics', desc: 'Track team workload and efficiency', path: '/analytics' },
                ].map((feature, index) => (
                  <Box
                    key={index}
                    onClick={() => navigate(feature.path)}
                    sx={{
                      mb: 2, p: 1.5,
                      border: '1px solid',
                      borderColor: 'grey.200',
                      borderRadius: 1,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      '&:hover': {
                        borderColor: '#7C3AED',
                        bgcolor: 'rgba(124,58,237,0.06)',
                        boxShadow: '0 2px 8px rgba(124,58,237,0.15)',
                        transform: 'translateY(-1px)',
                      },
                    }}
                  >
                    <Typography variant="subtitle2">
                      {feature.icon} {feature.title}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      {feature.desc}
                    </Typography>
                  </Box>
                ))}
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