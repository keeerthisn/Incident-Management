import React, { useEffect, useMemo, useState } from 'react';
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
  Link,
} from '@mui/material';
import {
  Psychology,
  AutoAwesome,
  MenuBook,
  OpenInNew,
} from '@mui/icons-material';
import { useSearchParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';

interface JiraSettings {
  url: string;
  email: string;
  apiToken: string;
  projectKey: string;
  daysBack?: number;
  jql?: string;
}

interface AnalysisResult {
  rootCauseCategory: string;
  shortSummary: string;
  keyIndicators: string[];
  suggestedNextSteps: string[];
  confidence: number;
  scoreBreakdown: Record<string, number>;
  extractedDetails: {
    summary: string;
    status: string;
    priority: string;
    description: string;
    resolutionNotes: string;
    comments: string[];
    labels: string[];
    components: string[];
    logHints: string[];
  };
}

const RootCauseAnalyzer: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [ticketKey, setTicketKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [rovoSummary, setRovoSummary] = useState<string | null>(null);
  const [rovoSource, setRovoSource] = useState<string>('');
  const [rovoLoading, setRovoLoading] = useState(false);
  const [confluenceLink, setConfluenceLink] = useState<{ url: string; title: string } | null>(null);
  const [confluenceLoading, setConfluenceLoading] = useState(false);

  const jiraConfigured = useMemo(() => {
    try {
      const raw = localStorage.getItem('jiraSettings');
      if (!raw) return false;
      const settings = JSON.parse(raw) as JiraSettings;
      return Boolean(settings.url && settings.email && settings.apiToken);
    } catch {
      return false;
    }
  }, []);

  const getJiraSettings = (): JiraSettings | null => {
    try {
      const raw = localStorage.getItem('jiraSettings');
      if (!raw) return null;
      return JSON.parse(raw) as JiraSettings;
    } catch {
      return null;
    }
  };

  const jiraBaseUrl = useMemo(() => {
    const s = getJiraSettings();
    return s?.url?.replace(/\/+$/, '') || '';
  }, []);

  const analyzeTicket = async (inputTicketKey: string) => {
    const normalizedTicketKey = inputTicketKey.trim().toUpperCase();
    if (!normalizedTicketKey) {
      setError('Please enter a JIRA ticket ID (for example: NCIP-1234).');
      return;
    }

    const jiraSettings = getJiraSettings();
    if (!jiraSettings?.url || !jiraSettings?.email || !jiraSettings?.apiToken) {
      setError('Jira is not configured. Go to Settings and save your Jira credentials first.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setRovoSummary(null);
    setRovoSource('');
    setRovoLoading(true);
    setConfluenceLink(null);
    setConfluenceLoading(true);

    try {
      // Fire all three requests in parallel
      const [analysisResponse, rovoResponse, confluenceResponse] = await Promise.allSettled([
        fetch(`${API_BASE_URL}/api/root-cause-analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketKey: normalizedTicketKey,
            jiraSettings,
          }),
        }),
        fetch(`${API_BASE_URL}/api/rovo-summarize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketKey: normalizedTicketKey,
            jiraSettings,
          }),
        }),
        fetch(`${API_BASE_URL}/api/batch-confluence-links`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketKeys: [normalizedTicketKey],
            jiraSettings,
          }),
        }),
      ]);

      // Handle analysis result
      if (analysisResponse.status === 'fulfilled') {
        const data = await analysisResponse.value.json();
        if (!analysisResponse.value.ok) {
          throw new Error(data.detail || `Analysis failed (${analysisResponse.value.status})`);
        }
        setResult(data.analysis as AnalysisResult);
      } else {
        throw new Error('Failed to analyze ticket');
      }

      // Handle Rovo summary result
      if (rovoResponse.status === 'fulfilled' && rovoResponse.value.ok) {
        const rovoData = await rovoResponse.value.json();
        setRovoSummary(rovoData.summary || null);
        setRovoSource(rovoData.source || 'local');
      }

      // Handle Confluence link result
      if (confluenceResponse.status === 'fulfilled' && confluenceResponse.value.ok) {
        const cData = await confluenceResponse.value.json();
        const link = cData.links?.[normalizedTicketKey];
        if (link && link.url) {
          setConfluenceLink({ url: link.url, title: link.title || `Confluence: ${normalizedTicketKey}` });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze ticket');
    } finally {
      setLoading(false);
      setRovoLoading(false);
      setConfluenceLoading(false);
    }
  };

  const handleAnalyze = async () => {
    await analyzeTicket(ticketKey);
  };

  useEffect(() => {
    const queryTicket = (searchParams.get('ticket') || '').trim().toUpperCase();
    if (!queryTicket) return;
    setTicketKey(queryTicket);
    analyzeTicket(queryTicket);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        🧠 Root Cause Analyzer
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Enter a JIRA ticket ID to fetch issue details and run explainable root cause classification.
      </Typography>

      {!jiraConfigured && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Jira credentials are not configured. Save them in Settings before analyzing tickets.
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={8}>
              <TextField
                fullWidth
                label="JIRA Ticket ID"
                placeholder="NCIP-1234"
                value={ticketKey}
                onChange={(e) => setTicketKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAnalyze();
                  }
                }}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <Button
                fullWidth
                variant="contained"
                startIcon={loading ? <CircularProgress size={18} /> : <Psychology />}
                onClick={handleAnalyze}
                disabled={loading}
              >
                {loading ? 'Analyzing...' : 'Analyze'}
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {(result || rovoLoading || rovoSummary) && (
        <Grid container spacing={3}>
          {/* Rovo AI Summary Card */}
          <Grid item xs={12}>
            <Card sx={{ border: '1px solid', borderColor: 'rgba(124,58,237,0.25)', background: 'linear-gradient(135deg, rgba(91,45,145,0.03), rgba(124,58,237,0.06))' }}>
              <CardContent>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <AutoAwesome sx={{ color: '#7C3AED' }} />
                  <Typography variant="h6" fontWeight={700}>
                    AI Summary of{' '}
                    <Link
                      href={jiraBaseUrl ? `${jiraBaseUrl}/browse/${ticketKey.trim().toUpperCase()}` : '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      underline="hover"
                      sx={{ color: '#7C3AED', fontWeight: 700 }}
                    >
                      {ticketKey.trim().toUpperCase()}
                    </Link>
                  </Typography>
                  {rovoSource && (
                    <Chip
                      label={rovoSource === 'rovo' ? 'Rovo AI' : 'Auto-Generated'}
                      size="small"
                      sx={{
                        ml: 1,
                        bgcolor: rovoSource === 'rovo' ? '#7C3AED' : '#5B2D91',
                        color: '#fff',
                        fontSize: '0.7rem',
                        height: 22,
                      }}
                    />
                  )}
                  {/* Confluence page link */}
                  {confluenceLoading && !confluenceLink && (
                    <CircularProgress size={14} sx={{ ml: 1, color: '#7C3AED' }} />
                  )}
                  {confluenceLink && (
                    <Link
                      href={confluenceLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      underline="none"
                      title={confluenceLink.title}
                      sx={{
                        ml: 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.4,
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: '#5B2D91',
                        bgcolor: 'rgba(124,58,237,0.08)',
                        border: '1px solid rgba(124,58,237,0.2)',
                        borderRadius: 1,
                        px: 0.8,
                        py: 0.2,
                        height: 24,
                        textDecoration: 'none',
                        '&:hover': { bgcolor: 'rgba(124,58,237,0.15)' },
                      }}
                    >
                      <MenuBook sx={{ fontSize: 14 }} /> Confluence <OpenInNew sx={{ fontSize: 11 }} />
                    </Link>
                  )}
                </Box>

                {/* Root Cause Category from analysis */}
                {result && (
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#5B2D91' }}>Root Cause Category:</Typography>
                    <Chip color="primary" label={result.rootCauseCategory} size="small" />
                  </Box>
                )}

                {rovoLoading && !rovoSummary ? (
                  <Box display="flex" alignItems="center" gap={2} py={2}>
                    <CircularProgress size={20} sx={{ color: '#7C3AED' }} />
                    <Typography variant="body2" color="text.secondary">Generating AI summary…</Typography>
                  </Box>
                ) : rovoSummary ? (
                  <Box>
                    {rovoSummary.split('\n').map((line, idx) => {
                      const trimmed = line.trim();
                      if (!trimmed) return <Box key={idx} sx={{ height: 8 }} />;
                      // Render **bold** sections as subtitles
                      const boldMatch = trimmed.match(/^\*\*(.+?)\*\*$/);
                      if (boldMatch) {
                        // Skip "Root Cause Category" heading since we show it as a chip above
                        if (boldMatch[1] === 'Root Cause Category') return null;
                        return (
                          <Typography key={idx} variant="subtitle2" fontWeight={700} sx={{ mt: 1.5, mb: 0.5, color: '#5B2D91' }}>
                            {boldMatch[1]}
                          </Typography>
                        );
                      }
                      // Skip the root cause category value line (shown as chip above)
                      if (idx > 0) {
                        const prevLine = rovoSummary.split('\n')[idx - 1]?.trim();
                        if (prevLine === '**Root Cause Category**') return null;
                      }
                      // Render **bold** inline text
                      const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
                      return (
                        <Typography key={idx} variant="body2" color="text.secondary" sx={{ mb: 0.3, lineHeight: 1.6 }}>
                          {parts.map((part, pi) => {
                            const inlineBold = part.match(/^\*\*(.+?)\*\*$/);
                            if (inlineBold) return <strong key={pi} style={{ color: '#333' }}>{inlineBold[1]}</strong>;
                            return <span key={pi}>{part}</span>;
                          })}
                        </Typography>
                      );
                    })}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">Summary not available.</Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default RootCauseAnalyzer;
