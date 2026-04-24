import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Alert,
  CircularProgress,
  Chip,
  List,
  ListItem,
  ListItemText,
  Divider,
  Link,
  Button,
  Tabs,
  Tab,
} from '@mui/material';
import { OpenInNew, Search, BugReport, MenuBook } from '@mui/icons-material';
import { Tooltip } from '@mui/material';
import { API_BASE_URL } from '../config';

interface JiraSettings {
  url: string;
  email: string;
  apiToken: string;
  projectKey: string;
  daysBack?: number;
  jql?: string;
  confluenceSpaces?: string;
}

const scoreColor = (score: number) => {
  if (score >= 70) return 'error';
  if (score >= 45) return 'warning';
  return 'default';
};

const ResolutionAssistant: React.FC = () => {
  const [error, setError] = useState<string | null>(null);

  // ── Investigation state ──
  const [investigateKey, setInvestigateKey] = useState('');
  const [investigateLoading, setInvestigateLoading] = useState(false);
  const [investigateError, setInvestigateError] = useState<string | null>(null);
  const [investigateResult, setInvestigateResult] = useState<any>(null);
  const [investigateTab, setInvestigateTab] = useState(0);

  const [confluenceLinks, setConfluenceLinks] = useState<Record<string, { url: string; title: string } | null>>({});
  const [confluenceLinksLoading, setConfluenceLinksLoading] = useState(false);
  const confluenceLookedUp = useRef<Set<string>>(new Set());

  const jiraBaseUrl = useMemo(() => {
    try {
      const raw = localStorage.getItem('jiraSettings');
      if (!raw) return '';
      const settings = JSON.parse(raw) as JiraSettings;
      return (settings.url || '').replace(/\/$/, '');
    } catch {
      return '';
    }
  }, []);

  /** Build a Confluence URL for a ticket key — direct page if matched, or search fallback */
  const getConfluenceUrl = useCallback((ticketKey: string): { url: string; title: string; isDirect: boolean } | null => {
    if (!jiraBaseUrl) return null;
    const matched = confluenceLinks[ticketKey];
    if (matched) {
      return { url: matched.url, title: matched.title, isDirect: true };
    }
    // Fallback: link to Confluence search for this ticket key
    const confluenceSpaces = (() => {
      try { return (JSON.parse(localStorage.getItem('jiraSettings') || '{}') as JiraSettings).confluenceSpaces || ''; } catch { return ''; }
    })();
    const spaceParam = confluenceSpaces ? `&where=space+%3D+%22${encodeURIComponent(confluenceSpaces.split(',')[0].trim())}%22` : '';
    const searchUrl = `${jiraBaseUrl}/wiki/search?text=${encodeURIComponent(ticketKey)}${spaceParam}`;
    return { url: searchUrl, title: `Search Confluence for ${ticketKey}`, isDirect: false };
  }, [jiraBaseUrl, confluenceLinks]);

  const getJiraSettings = (): JiraSettings | null => {
    try {
      const raw = localStorage.getItem('jiraSettings');
      if (!raw) return null;
      return JSON.parse(raw) as JiraSettings;
    } catch {
      return null;
    }
  };

  // ── Investigation handler ──
  const handleInvestigate = async (ticketKey?: string) => {
    const key = (ticketKey || investigateKey).trim().toUpperCase();
    if (!key) return;
    const settings = getJiraSettings();
    if (!settings) {
      setInvestigateError('Configure Jira settings first (Settings page).');
      return;
    }
    setInvestigateKey(key);
    setInvestigateLoading(true);
    setInvestigateError(null);
    setInvestigateResult(null);
    setInvestigateTab(0);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const resp = await fetch(`${API_BASE_URL}/api/resolution-assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketKey: key, jiraSettings: settings }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.detail || `Investigation failed (${resp.status})`);
      setInvestigateResult(data);
      // Fetch Confluence links for the investigated ticket AND similar tickets
      const similarTickets = data.similarOrDuplicateTickets || [];
      const allKeys = [key, ...similarTickets.map((t: any) => t.ticketKey).filter(Boolean)];
      {
        const newKeys = allKeys.filter((k: string) => !confluenceLookedUp.current.has(k));
        if (newKeys.length > 0) {
          newKeys.forEach((k: string) => confluenceLookedUp.current.add(k));
          fetch(`${API_BASE_URL}/api/batch-confluence-links`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticketKeys: newKeys.slice(0, 50), jiraSettings: settings }),
          })
            .then((r) => r.json())
            .then((d) => {
              if (d.links) setConfluenceLinks((prev) => ({ ...prev, ...d.links }));
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        setInvestigateError('Investigation timed out after 90 seconds.');
      } else {
        setInvestigateError(err instanceof Error ? err.message : 'Investigation failed');
      }
    } finally {
      setInvestigateLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        🧭 Resolution Assistant
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Investigate tickets and search the knowledge base.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* ═══════════ Investigate a Ticket ═══════════ */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <BugReport fontSize="small" /> Investigate a Ticket
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter a Jira ticket key to get root cause analysis, workarounds, Knowledge Base references, and similar tickets.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 2 }}>
            <TextField
              size="small"
              label="Ticket Key"
              placeholder="e.g. NCIP-1234"
              value={investigateKey}
              onChange={(e) => setInvestigateKey(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleInvestigate()}
              sx={{ width: 200 }}
            />
            <Button
              variant="contained"
              onClick={() => handleInvestigate()}
              disabled={investigateLoading || !investigateKey.trim()}
              startIcon={investigateLoading ? <CircularProgress size={18} /> : <Search />}
            >
              {investigateLoading ? 'Investigating…' : 'Investigate'}
            </Button>
          </Box>

          {investigateError && (
            <Alert severity="error" sx={{ mb: 2 }}>{investigateError}</Alert>
          )}

          {investigateResult && (
            <Box sx={{ mt: 2 }}>
              {/* Summary */}
              {investigateResult.summary && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  {(investigateResult.summary as string[]).map((s: string, i: number) => (
                    <Typography key={i} variant="body2">{s}</Typography>
                  ))}
                </Alert>
              )}

              <Tabs value={investigateTab} onChange={(_, v) => setInvestigateTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Tab label="Root Cause" />
                <Tab label="Workarounds" />
                <Tab label="Playbook" />
                <Tab label={`Knowledge Base (${(investigateResult.knowledgeBaseReferences?.references || []).length + (getConfluenceUrl(investigateKey) ? 1 : 0)})`} />
                <Tab label={`Similar (${(investigateResult.similarOrDuplicateTickets || []).length})`} />
              </Tabs>

              {/* Tab 0: Root Cause */}
              {investigateTab === 0 && investigateResult.probableRootCause && (
                <Box>
                  {/* Root cause category + confidence */}
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1, color: '#5B2D91' }}>Root Cause Category</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                      <Chip
                        label={investigateResult.probableRootCause.summary || 'Unknown'}
                        color={investigateResult.probableRootCause.summary === 'Unknown / Needs Investigation' ? 'default' : 'primary'}
                        sx={{ fontWeight: 'bold', fontSize: '0.95rem', py: 0.5 }}
                      />
                      {investigateResult.probableRootCause.confidence != null && (
                        <Chip
                          label={`Confidence: ${Math.round(investigateResult.probableRootCause.confidence * 100)}%`}
                          size="small"
                          color={investigateResult.probableRootCause.confidence >= 0.7 ? 'success' : investigateResult.probableRootCause.confidence >= 0.5 ? 'warning' : 'default'}
                          variant="outlined"
                        />
                      )}
                    </Box>
                    <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                      Based on ticket description, resolution notes, and historical patterns
                    </Typography>
                  </Box>

                  {/* Hypothesis / short summary */}
                  {investigateResult.probableRootCause.hypothesis && (
                    <Typography variant="body1" sx={{ mb: 1.5, color: 'text.secondary' }}>
                      {investigateResult.probableRootCause.hypothesis}
                    </Typography>
                  )}

                  {/* Score breakdown across categories */}
                  {investigateResult.probableRootCause.scoreBreakdown && Object.keys(investigateResult.probableRootCause.scoreBreakdown).length > 0 && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>Score Breakdown</Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {Object.entries(investigateResult.probableRootCause.scoreBreakdown as Record<string, number>)
                          .sort(([, a], [, b]) => b - a)
                          .map(([category, score]) => (
                            <Chip
                              key={category}
                              label={`${category}: ${score}`}
                              size="small"
                              variant={category === investigateResult.probableRootCause.summary ? 'filled' : 'outlined'}
                              color={category === investigateResult.probableRootCause.summary ? 'primary' : 'default'}
                            />
                          ))}
                      </Box>
                    </Box>
                  )}

                  {/* Suggested next steps */}
                  {(investigateResult.probableRootCause.suggestedNextSteps || []).length > 0 && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 0.5 }}>Suggested Next Steps</Typography>
                      <List dense>
                        {(investigateResult.probableRootCause.suggestedNextSteps as string[]).map((step: string, i: number) => (
                          <ListItem key={i}><ListItemText primary={`${i + 1}. ${step}`} /></ListItem>
                        ))}
                      </List>
                    </Box>
                  )}

                  {/* Risk indicators */}
                  {investigateResult.riskIndicators && (
                    <Alert severity={investigateResult.riskIndicators.widespreadRisk ? 'warning' : 'success'} sx={{ mt: 1.5 }}>
                      {investigateResult.riskIndicators.trendSummary}
                    </Alert>
                  )}
                </Box>
              )}

              {/* Tab 1: Workarounds */}
              {investigateTab === 1 && (
                <Box>
                  {(investigateResult.workarounds?.confirmedFixes || []).length > 0 && (
                    <>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>Confirmed Fixes</Typography>
                      <List dense>
                        {(investigateResult.workarounds.confirmedFixes as string[]).map((f: string, i: number) => (
                          <ListItem key={i}><ListItemText primary={f} /></ListItem>
                        ))}
                      </List>
                    </>
                  )}
                  {(investigateResult.workarounds?.temporaryMitigations || []).length > 0 && (
                    <>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mt: 1, mb: 1 }}>Temporary Mitigations</Typography>
                      <List dense>
                        {(investigateResult.workarounds.temporaryMitigations as string[]).map((m: string, i: number) => (
                          <ListItem key={i}><ListItemText primary={m} /></ListItem>
                        ))}
                      </List>
                    </>
                  )}
                  {(investigateResult.workarounds?.confirmedFixes || []).length === 0 &&
                   (investigateResult.workarounds?.temporaryMitigations || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary">No workarounds found for this ticket.</Typography>
                  )}
                </Box>
              )}

              {/* Tab 2: Playbook */}
              {investigateTab === 2 && investigateResult.troubleshootingSteps && (
                <Box>
                  {(investigateResult.troubleshootingSteps.nextActions || []).length > 0 && (
                    <>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>Next Actions</Typography>
                      <List dense>
                        {(investigateResult.troubleshootingSteps.nextActions as string[]).map((a: string, i: number) => (
                          <ListItem key={i}><ListItemText primary={`${i + 1}. ${a}`} /></ListItem>
                        ))}
                      </List>
                    </>
                  )}
                  {investigateResult.troubleshootingSteps.playbook && (
                    <>
                      <Divider sx={{ my: 1 }} />
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>Questions for Customer</Typography>
                      <List dense>
                        {(investigateResult.troubleshootingSteps.playbook.questionsForCustomer || []).map((q: string, i: number) => (
                          <ListItem key={i}><ListItemText primary={q} /></ListItem>
                        ))}
                      </List>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mt: 1, mb: 1 }}>Configurations to Validate</Typography>
                      <List dense>
                        {(investigateResult.troubleshootingSteps.playbook.configurationsToValidate || []).map((c: string, i: number) => (
                          <ListItem key={i}><ListItemText primary={c} /></ListItem>
                        ))}
                      </List>
                    </>
                  )}
                </Box>
              )}

              {/* Tab 3: Knowledge Base Articles */}
              {investigateTab === 3 && (
                <Box>
                  {/* Confluence link for this ticket */}
                  {(() => {
                    const cfl = getConfluenceUrl(investigateKey);
                    if (confluenceLinksLoading && !confluenceLinks[investigateKey]) return <CircularProgress size={16} sx={{ mb: 1 }} />;
                    if (!cfl) return null;
                    return (
                      <Box sx={{ mb: 2 }}>
                        <Tooltip title={cfl.title} arrow>
                          <Link
                            href={cfl.url}
                            target="_blank"
                            rel="noreferrer"
                            underline="hover"
                            sx={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 0.5,
                              fontSize: 13,
                              fontWeight: 700,
                              color: cfl.isDirect ? '#1565c0' : '#6a1b9a',
                              bgcolor: cfl.isDirect ? '#e3f2fd' : '#f3e5f5',
                              border: `1px solid ${cfl.isDirect ? '#90caf944' : '#ce93d844'}`,
                              borderRadius: 1,
                              px: 1.2,
                              py: 0.5,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <MenuBook sx={{ fontSize: 16 }} /> Search Confluence for {investigateKey} <OpenInNew sx={{ fontSize: 12 }} />
                          </Link>
                        </Tooltip>
                      </Box>
                    );
                  })()}

                  {(investigateResult.knowledgeBaseReferences?.references || []).length > 0 ? (
                    <List dense>
                      {(investigateResult.knowledgeBaseReferences.references as Array<{ title: string; url: string; excerpt: string }>).map((kb, i) => (
                        <React.Fragment key={i}>
                          <ListItem>
                            <ListItemText
                              primary={
                                <Link href={kb.url} target="_blank" rel="noopener" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  {kb.title} <OpenInNew fontSize="inherit" />
                                </Link>
                              }
                              secondary={kb.excerpt}
                            />
                          </ListItem>
                          {i < (investigateResult.knowledgeBaseReferences.references.length - 1) && <Divider />}
                        </React.Fragment>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {investigateResult.knowledgeBaseReferences?.note || 'No Knowledge Base articles found.'}
                    </Typography>
                  )}
                </Box>
              )}

              {/* Tab 4: Similar Tickets */}
              {investigateTab === 4 && (
                <Box>
                  {(investigateResult.similarOrDuplicateTickets || []).length > 0 ? (
                    <List dense>
                      {(investigateResult.similarOrDuplicateTickets as Array<any>).map((t: any, i: number) => (
                        <React.Fragment key={i}>
                          <ListItem>
                            <ListItemText
                              primary={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                  {t.reference ? (
                                    <Link href={t.reference} target="_blank" rel="noopener" sx={{ fontWeight: 'bold' }}>
                                      {t.ticketKey} <OpenInNew fontSize="inherit" />
                                    </Link>
                                  ) : (
                                    <Typography fontWeight="bold" component="span">{t.ticketKey}</Typography>
                                  )}
                                  <Chip label={`${t.similarityConfidence || 0}%`} size="small" color={scoreColor(t.similarityConfidence || 0)} />
                                  <Chip label={t.status} size="small" variant="outlined" />
                                  {/* Confluence page link */}
                                  {(() => {
                                    const cfl = getConfluenceUrl(t.ticketKey);
                                    if (confluenceLinksLoading && !confluenceLinks[t.ticketKey]) return <CircularProgress size={14} />;
                                    if (!cfl) return null;
                                    return (
                                      <Tooltip title={cfl.title} arrow>
                                        <Link
                                          href={cfl.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          underline="hover"
                                          sx={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 0.4,
                                            fontSize: 12,
                                            fontWeight: 700,
                                            color: cfl.isDirect ? '#1565c0' : '#6a1b9a',
                                            bgcolor: cfl.isDirect ? '#e3f2fd' : '#f3e5f5',
                                            border: `1px solid ${cfl.isDirect ? '#90caf944' : '#ce93d844'}`,
                                            borderRadius: 1,
                                            px: 0.8,
                                            py: 0.2,
                                          }}
                                        >
                                          <MenuBook sx={{ fontSize: 14 }} /> Confluence <OpenInNew sx={{ fontSize: 11 }} />
                                        </Link>
                                      </Tooltip>
                                    );
                                  })()}
                                  <Typography variant="body2" component="span">{t.summary}</Typography>
                                </Box>
                              }
                              secondary={t.resolutionSnippet || ''}
                            />
                          </ListItem>
                          {i < ((investigateResult.similarOrDuplicateTickets || []).length - 1) && <Divider />}
                        </React.Fragment>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="body2" color="text.secondary">No similar tickets found.</Typography>
                  )}
                </Box>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

    </Box>
  );
};

export default ResolutionAssistant;
