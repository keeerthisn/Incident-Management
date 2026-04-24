import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Grid,
  Alert,
  CircularProgress,
  Chip,
  Autocomplete,
} from '@mui/material';
import { Save, Science, Storage } from '@mui/icons-material';
import { API_BASE_URL } from '../config';

const Settings: React.FC = () => {
  const [jiraSettings, setJiraSettings] = useState({
    url: 'https://n-able.atlassian.net',
    email: '',
    apiToken: '',
    projectKey: 'NCIP',
    daysBack: 90,
    jql: '',
    confluenceSpaces: '',
  });

  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'testing' | 'success' | 'error'>('unknown');
  const [connectionMessage, setConnectionMessage] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  // Confluence debug / test state
  const [debugTicketKey, setDebugTicketKey] = useState('');
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugResult, setDebugResult] = useState<any>(null);

  // Confluence space picker state
  const [availableSpaces, setAvailableSpaces] = useState<Array<{key: string; name: string}>>([]);
  const [spacesLoading, setSpacesLoading] = useState(false);
  const [spacesError, setSpacesError] = useState<string | null>(null);

  // Load existing settings on component mount
  useEffect(() => {
    const savedSettings = localStorage.getItem('jiraSettings');
    if (savedSettings) {
      try {
        const parsedSettings = JSON.parse(savedSettings);
        setJiraSettings({ url: 'https://n-able.atlassian.net', projectKey: 'NCIP', daysBack: 90, jql: '', confluenceSpaces: '', ...parsedSettings });
      } catch (error) {
        console.error('Error loading saved Jira settings:', error);
      }
    }
  }, []);

  const testConnection = async () => {
    if (!jiraSettings.url || !jiraSettings.email || !jiraSettings.apiToken) {
      alert('Please fill in Jira URL, Email and API Token first.');
      return;
    }

    const normalizedSettings = {
      ...jiraSettings,
      url: jiraSettings.url.trim(),
      email: jiraSettings.email.trim(),
      apiToken: jiraSettings.apiToken.trim(),
    };
    
    setConnectionStatus('testing');
    setConnectionMessage('Connecting to Jira...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizedSettings),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      const data = await response.json();
      
      if (response.ok) {
        setConnectionStatus('success');
        setConnectionMessage(data.message);
      } else {
        setConnectionStatus('error');
        setConnectionMessage(data.detail || 'Connection failed');
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        setConnectionStatus('error');
        setConnectionMessage('Timed out after 60s — check VPN/network and confirm Jira URL is reachable');
      } else {
        setConnectionStatus('error');
        setConnectionMessage(`Cannot reach backend (${API_BASE_URL}). Is it running?`);
      }
    }
  };

  const saveSettings = () => {
    setSaving(true);
    
    // Save to localStorage
    localStorage.setItem('jiraSettings', JSON.stringify(jiraSettings));
    // Trigger a custom event to notify other components
    window.dispatchEvent(new CustomEvent('jiraSettingsUpdated'));
    
    setTimeout(() => {
      setSaving(false);
      setSuccess('Settings saved successfully!');
      setTimeout(() => setSuccess(null), 3000);
    }, 1000);
  };

  const getConnectionIcon = () => {
    switch (connectionStatus) {
      case 'testing': return '🔄';
      case 'success': return '✅';
      case 'error': return '❌';
      default: return '';
    }
  };

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        ⚙️ Settings
      </Typography>

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Jira Configuration */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                🔗 Jira Configuration
              </Typography>
              
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Jira URL"
                    value={jiraSettings.url}
                    onChange={(e) => setJiraSettings({ ...jiraSettings, url: e.target.value })}
                    helperText="n-able Atlassian instance"
                  />
                </Grid>
                
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Email"
                    type="email"
                    placeholder="your-email@n-able.com"
                    value={jiraSettings.email}
                    onChange={(e) => setJiraSettings({ ...jiraSettings, email: e.target.value })}
                    helperText="Your n-able Atlassian account email"
                  />
                </Grid>
                
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="API Token"
                    type="password"
                    placeholder="Your Atlassian API token"
                    value={jiraSettings.apiToken}
                    onChange={(e) => setJiraSettings({ ...jiraSettings, apiToken: e.target.value })}
                    helperText="Generate at id.atlassian.com → Security → API tokens"
                  />
                </Grid>
                
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Project Key"
                    value={jiraSettings.projectKey}
                    onChange={(e) => setJiraSettings({ ...jiraSettings, projectKey: e.target.value })}
                    helperText="NCIP — board 3719"
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Custom JQL filter (optional)"
                    multiline
                    minRows={2}
                    value={jiraSettings.jql}
                    onChange={(e) => setJiraSettings({ ...jiraSettings, jql: e.target.value })}
                    helperText="Paste the JQL used by your NCIP board quick filter to fetch exactly those tickets. Leave blank to use the default NCIP query."
                  />
                </Grid>

                {/* Confluence Spaces */}
                <Grid item xs={12}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <TextField
                      fullWidth
                      label="Confluence Space Keys (for Knowledge Base search)"
                      value={jiraSettings.confluenceSpaces}
                      onChange={(e) => setJiraSettings({ ...jiraSettings, confluenceSpaces: e.target.value })}
                      placeholder="e.g. ENG,KB,OPS"
                      helperText={
                        availableSpaces.length > 0
                          ? `${availableSpaces.length} spaces available — type a key or click "Load Spaces" to browse`
                          : 'Comma-separated Confluence space keys to scope Knowledge Base search. Leave blank to search all spaces.'
                      }
                    />
                    <Button
                      variant="outlined"
                      startIcon={spacesLoading ? <CircularProgress size={18} /> : <Storage />}
                      onClick={async () => {
                        if (!jiraSettings.url || !jiraSettings.email || !jiraSettings.apiToken) {
                          setSpacesError('Fill in Jira URL, Email, and API Token first.');
                          return;
                        }
                        setSpacesLoading(true);
                        setSpacesError(null);
                        try {
                          const resp = await fetch(`${API_BASE_URL}/api/confluence-spaces`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(jiraSettings),
                          });
                          const data = await resp.json().catch(() => ({}));
                          if (!resp.ok) throw new Error(data.detail || 'Failed to load spaces');
                          setAvailableSpaces(data.spaces || []);
                        } catch (err) {
                          setSpacesError(err instanceof Error ? err.message : 'Failed to load spaces');
                        } finally {
                          setSpacesLoading(false);
                        }
                      }}
                      disabled={spacesLoading}
                      sx={{ minWidth: 150, height: 56, whiteSpace: 'nowrap' }}
                    >
                      {spacesLoading ? 'Loading…' : 'Load Spaces'}
                    </Button>
                  </Box>
                  {spacesError && (
                    <Alert severity="error" sx={{ mt: 1 }}>{spacesError}</Alert>
                  )}
                  {availableSpaces.length > 0 && (
                    <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 140, overflowY: 'auto' }}>
                      {availableSpaces.map((sp) => {
                        const selected = (jiraSettings.confluenceSpaces || '').toUpperCase().split(',').map(s => s.trim()).includes(sp.key.toUpperCase());
                        return (
                          <Chip
                            key={sp.key}
                            label={`${sp.key} — ${sp.name}`}
                            size="small"
                            color={selected ? 'primary' : 'default'}
                            variant={selected ? 'filled' : 'outlined'}
                            onClick={() => {
                              const current = (jiraSettings.confluenceSpaces || '').split(',').map(s => s.trim()).filter(Boolean);
                              const upperKey = sp.key.toUpperCase();
                              if (current.map(c => c.toUpperCase()).includes(upperKey)) {
                                setJiraSettings({ ...jiraSettings, confluenceSpaces: current.filter(c => c.toUpperCase() !== upperKey).join(',') });
                              } else {
                                setJiraSettings({ ...jiraSettings, confluenceSpaces: [...current, sp.key].join(',') });
                              }
                            }}
                            sx={{ cursor: 'pointer' }}
                          />
                        );
                      })}
                    </Box>
                  )}
                </Grid>
                
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Fetch Last N Days"
                    type="number"
                    inputProps={{ min: 1, max: 3650 }}
                    value={jiraSettings.daysBack}
                    onChange={(e) => setJiraSettings({ ...jiraSettings, daysBack: parseInt(e.target.value) || 90 })}
                    helperText="Fetch tickets created in the last N days (default: 90)"
                  />
                </Grid>
                
                <Grid item xs={12} md={6}>
                  <Button
                    variant="outlined"
                    startIcon={connectionStatus === 'testing' ? <CircularProgress size={20} /> : <Science />}
                    onClick={testConnection}
                    disabled={connectionStatus === 'testing'}
                    fullWidth
                    sx={{ height: 56 }}
                  >
                    {connectionStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                  </Button>
                </Grid>
                
                {connectionMessage && (
                  <Grid item xs={12}>
                    <Alert severity={connectionStatus === 'success' ? 'success' : 'error'}>
                      {connectionMessage}
                    </Alert>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Quick Setup Guide */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                📋 Setup Guide
              </Typography>

              <Alert severity="info" sx={{ mb: 2, fontSize: '0.8rem' }}>
                Connecting to <strong>n-able.atlassian.net</strong> → NCIP board
              </Alert>
              
              <Typography variant="body2" paragraph>
                To get your API token:
              </Typography>
              
              <Box component="ol" sx={{ pl: 2, fontSize: '0.875rem' }}>
                <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                  Go to{' '}
                  <strong>
                    <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">
                      id.atlassian.com → Security → API tokens
                    </a>
                  </strong>
                </Typography>
                <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                  Click <strong>"Create API token"</strong>
                </Typography>
                <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                  Label it <strong>"Incident Triage Tool"</strong>
                </Typography>
                <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                  Copy and paste the token into the <strong>API Token</strong> field
                </Typography>
                <Typography component="li" variant="body2">
                  Click <strong>Test Connection</strong> to verify
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Test Confluence Links */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                🔍 Test Confluence Links
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Enter a ticket key to diagnose how Confluence pages are linked. This checks multiple methods: CQL title search, text search, Jira remote links, and issue links.
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
                <TextField
                  label="Ticket Key"
                  placeholder="e.g. NCIP-10001"
                  value={debugTicketKey}
                  onChange={(e) => setDebugTicketKey(e.target.value.toUpperCase())}
                  size="small"
                  sx={{ width: 200 }}
                />
                <Button
                  variant="outlined"
                  startIcon={debugLoading ? <CircularProgress size={18} /> : <Science />}
                  disabled={debugLoading || !debugTicketKey.trim()}
                  onClick={async () => {
                    setDebugLoading(true);
                    setDebugResult(null);
                    try {
                      const resp = await fetch(`${API_BASE_URL}/api/debug-confluence-pages`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ticketKeys: [debugTicketKey.trim()], jiraSettings: jiraSettings }),
                      });
                      const data = await resp.json().catch(() => ({}));
                      setDebugResult(data);
                    } catch (err) {
                      setDebugResult({ error: err instanceof Error ? err.message : 'Failed' });
                    } finally {
                      setDebugLoading(false);
                    }
                  }}
                >
                  {debugLoading ? 'Testing…' : 'Test'}
                </Button>
              </Box>
              {debugResult && (
                <Box sx={{ bgcolor: '#f5f5f5', borderRadius: 1, p: 2, maxHeight: 400, overflow: 'auto' }}>
                  <Typography variant="subtitle2" gutterBottom>Confluence Space Keys configured: {JSON.stringify(debugResult.spaceKeys || [])}</Typography>

                  <Typography variant="subtitle2" sx={{ mt: 1 }}>Sample pages in space ({(debugResult.samplePages || []).length}):</Typography>
                  {(debugResult.samplePages || []).map((p: any, i: number) => (
                    <Typography key={i} variant="body2" sx={{ ml: 2 }}>• {p.title} [{p.space}]</Typography>
                  ))}
                  {debugResult.samplePagesError && <Alert severity="error" sx={{ mt: 1 }}>{debugResult.samplePagesError}</Alert>}

                  <Typography variant="subtitle2" sx={{ mt: 1 }}>CQL Title search results:</Typography>
                  {Object.keys(debugResult.titleSearchResults || {}).length === 0
                    ? <Typography variant="body2" sx={{ ml: 2 }} color="text.secondary">No matches</Typography>
                    : Object.entries(debugResult.titleSearchResults || {}).map(([title, url]: any) => (
                      <Typography key={title} variant="body2" sx={{ ml: 2 }}>• {title} → {url}</Typography>
                    ))
                  }

                  <Typography variant="subtitle2" sx={{ mt: 1 }}>CQL Text search results:</Typography>
                  {Object.keys(debugResult.textSearchResults || {}).length === 0
                    ? <Typography variant="body2" sx={{ ml: 2 }} color="text.secondary">No matches</Typography>
                    : Object.entries(debugResult.textSearchResults || {}).map(([title, url]: any) => (
                      <Typography key={title} variant="body2" sx={{ ml: 2 }}>• {title} → {url}</Typography>
                    ))
                  }

                  <Typography variant="subtitle2" sx={{ mt: 1 }}>Jira Remote Links:</Typography>
                  {Object.entries(debugResult.jiraRemoteLinks || {}).map(([key, val]: any) => (
                    <Box key={key} sx={{ ml: 2 }}>
                      <Typography variant="body2" fontWeight="bold">{key}:</Typography>
                      {Array.isArray(val)
                        ? val.length === 0
                          ? <Typography variant="body2" sx={{ ml: 2 }} color="text.secondary">None</Typography>
                          : val.map((l: any, i: number) => <Typography key={i} variant="body2" sx={{ ml: 2 }}>• {l.title} → {l.url}</Typography>)
                        : <Typography variant="body2" sx={{ ml: 2 }} color="error.main">{String(val)}</Typography>
                      }
                    </Box>
                  ))}

                  <Typography variant="subtitle2" sx={{ mt: 1 }}>Jira Issue Links:</Typography>
                  {Object.entries(debugResult.jiraIssueLinks || {}).map(([key, val]: any) => (
                    <Box key={key} sx={{ ml: 2 }}>
                      <Typography variant="body2" fontWeight="bold">{key}:</Typography>
                      {Array.isArray(val)
                        ? val.length === 0
                          ? <Typography variant="body2" sx={{ ml: 2 }} color="text.secondary">None</Typography>
                          : val.map((l: any, i: number) => (
                            <Typography key={i} variant="body2" sx={{ ml: 2 }}>
                              • {l.type}: {l.outwardIssue || l.inwardIssue || '—'}
                            </Typography>
                          ))
                        : <Typography variant="body2" sx={{ ml: 2 }} color="error.main">{String(val)}</Typography>
                      }
                    </Box>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Save Button */}
      <Box mt={3} display="flex" justifyContent="flex-end">
        <Button
          variant="contained"
          size="large"
          startIcon={<Save />}
          onClick={saveSettings}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </Box>
    </Box>
  );
};

export default Settings;