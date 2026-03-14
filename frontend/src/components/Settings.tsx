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
  Switch,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';
import { Save, Science } from '@mui/icons-material';

const Settings: React.FC = () => {
  const [jiraSettings, setJiraSettings] = useState({
    url: 'https://n-able.atlassian.net',
    email: '',
    apiToken: '',
    projectKey: 'NCIP',
    daysBack: 30,
    jql: '',
  });
  
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'testing' | 'success' | 'error'>('unknown');
  const [connectionMessage, setConnectionMessage] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  // Load existing settings on component mount
  useEffect(() => {
    const savedSettings = localStorage.getItem('jiraSettings');
    if (savedSettings) {
      try {
        const parsedSettings = JSON.parse(savedSettings);
        setJiraSettings({ url: 'https://n-able.atlassian.net', projectKey: 'NCIP', daysBack: 30, jql: '', ...parsedSettings });
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
    
    setConnectionStatus('testing');
    setConnectionMessage('Connecting to Jira...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    
    try {
      const response = await fetch('http://localhost:8000/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jiraSettings),
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
        setConnectionMessage('Timed out — check your Jira URL and network');
      } else {
        setConnectionStatus('error');
        setConnectionMessage('Cannot reach backend (http://localhost:8000). Is it running?');
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
                
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Fetch Last N Days"
                    type="number"
                    inputProps={{ min: 1, max: 90 }}
                    value={jiraSettings.daysBack}
                    onChange={(e) => setJiraSettings({ ...jiraSettings, daysBack: parseInt(e.target.value) || 30 })}
                    helperText="Tickets updated in the last N days (default: 30)"
                  />
                </Grid>
                
                <Grid item xs={12} md={4}>
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

        {/* Additional Settings */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                🎛️ Triage Settings
              </Typography>
              
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={6}>
                  <FormControlLabel
                    control={<Switch defaultChecked />}
                    label="Enable Auto-Processing"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControlLabel
                    control={<Switch />}
                    label="Email Notifications"
                  />
                </Grid>
              </Grid>
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