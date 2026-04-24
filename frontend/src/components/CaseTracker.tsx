import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Collapse,
  Badge,
  InputAdornment,
  Tooltip,
  CircularProgress,
  Link,
  Card,
  CardContent,
  Grid,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import {
  Search as SearchIcon,
  ExpandMore,
  ExpandLess,
  OpenInNew,
  FilterList,
  FolderOpen,
  ConfirmationNumber,
  Business,
  Category,
} from '@mui/icons-material';
import { API_BASE_URL } from '../config';

/* ───── types ───── */
interface WebLink {
  title: string;
  url: string;
}

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
  product_name?: string;
  jira_components?: string;
  issue_type?: string;
  escalation?: string;
  linked_issues?: LinkedIssue[];
  web_links?: WebLink[];
  crm_id?: string;
}

interface CaseGroup {
  caseNumber: string;
  companyName: string;
  tickets: Ticket[];
  webLinks: WebLink[];
  statuses: string[];
  priorities: string[];
  products: string[];
}

/* ───── helpers ───── */
const priorityColor = (p: string) => {
  const pl = (p || '').toLowerCase();
  if (pl === 'critical' || pl === 'blocker') return '#DC2626';
  if (pl === 'major' || pl === 'high') return '#EA580C';
  if (pl === 'moderate' || pl === 'medium') return '#D97706';
  return '#6B7280';
};

const statusColor = (s: string) => {
  const sl = (s || '').toLowerCase();
  if (sl.includes('closed') || sl.includes('resolved') || sl.includes('done')) return '#16A34A';
  if (sl.includes('progress') || sl.includes('review')) return '#2563EB';
  if (sl.includes('waiting') || sl.includes('hold') || sl.includes('pending')) return '#D97706';
  return '#6B7280';
};

/** Extract case number (first part before " - ") from web link title */
function extractCaseNumber(title: string): string | null {
  if (!title) return null;
  // Pattern: "02666807 - Company - Description"
  const match = title.match(/^(\d{5,12})\s*-/);
  return match ? match[1] : null;
}

/** Extract company name (second part between hyphens) from web link title */
function extractCompanyName(title: string): string {
  if (!title) return '';
  const parts = title.split(/\s*-\s*/);
  return parts.length >= 2 ? parts[1].trim() : '';
}

/* ───── component ───── */
const CaseTracker: React.FC = () => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');
  const [groupBy, setGroupBy] = useState<'case' | 'company' | 'product'>('case');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  /* ── fetch tickets ── */
  useEffect(() => {
    const stored = localStorage.getItem('jiraSettings');
    const settings = stored ? JSON.parse(stored) : null;
    const projectKey = settings?.projectKey || 'INCIDENT';
    const daysBack = settings?.daysBack || 90;

    setLoading(true);
    fetch(`${API_BASE_URL}/api/tickets?projectKey=${projectKey}&daysBack=${daysBack}`)
      .then((r) => r.json())
      .then((data) => {
        setTickets(data.tickets || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  /* ── build case groups ── */
  const caseGroups = useMemo(() => {
    // Only tickets that have web_links with extractable case numbers
    const groups: Record<string, CaseGroup> = {};

    for (const ticket of tickets) {
      if (!ticket.web_links || ticket.web_links.length === 0) continue;

      for (const wl of ticket.web_links) {
        const caseNum = extractCaseNumber(wl.title);
        if (!caseNum) continue;

        if (!groups[caseNum]) {
          groups[caseNum] = {
            caseNumber: caseNum,
            companyName: extractCompanyName(wl.title),
            tickets: [],
            webLinks: [],
            statuses: [],
            priorities: [],
            products: [],
          };
        }
        // Avoid duplicate tickets in same group
        if (!groups[caseNum].tickets.some((t) => t.key === ticket.key)) {
          groups[caseNum].tickets.push(ticket);
          if (ticket.status && !groups[caseNum].statuses.includes(ticket.status))
            groups[caseNum].statuses.push(ticket.status);
          if (ticket.priority && !groups[caseNum].priorities.includes(ticket.priority))
            groups[caseNum].priorities.push(ticket.priority);
          if (ticket.product_name && !groups[caseNum].products.includes(ticket.product_name))
            groups[caseNum].products.push(ticket.product_name);
        }
        // Track web link
        if (!groups[caseNum].webLinks.some((l) => l.title === wl.title && l.url === wl.url))
          groups[caseNum].webLinks.push(wl);
      }
    }

    return Object.values(groups).sort((a, b) => b.tickets.length - a.tickets.length);
  }, [tickets]);

  /* ── unique values for filters ── */
  const allStatuses = useMemo(() => Array.from(new Set(caseGroups.flatMap((g) => g.statuses))).sort(), [caseGroups]);
  const allPriorities = useMemo(() => Array.from(new Set(caseGroups.flatMap((g) => g.priorities))).sort(), [caseGroups]);
  const allProducts = useMemo(() => Array.from(new Set(caseGroups.flatMap((g) => g.products))).sort(), [caseGroups]);

  /* ── filtered groups ── */
  const filteredGroups = useMemo(() => {
    return caseGroups.filter((g) => {
      // Search filter
      if (search) {
        const s = search.toLowerCase();
        const matchesCase = g.caseNumber.includes(s);
        const matchesCompany = g.companyName.toLowerCase().includes(s);
        const matchesTicket = g.tickets.some(
          (t) => t.key.toLowerCase().includes(s) || t.summary.toLowerCase().includes(s)
        );
        if (!matchesCase && !matchesCompany && !matchesTicket) return false;
      }
      // Status filter
      if (statusFilter !== 'all' && !g.tickets.some((t) => t.status === statusFilter)) return false;
      // Priority filter
      if (priorityFilter !== 'all' && !g.tickets.some((t) => t.priority === priorityFilter)) return false;
      // Product filter
      if (productFilter !== 'all' && !g.tickets.some((t) => t.product_name === productFilter)) return false;
      return true;
    });
  }, [caseGroups, search, statusFilter, priorityFilter, productFilter]);

  /* ── re-group by selected mode ── */
  const displayGroups = useMemo(() => {
    if (groupBy === 'case') {
      return filteredGroups.map((g) => ({
        key: g.caseNumber,
        label: `Case ${g.caseNumber}`,
        sublabel: g.companyName,
        tickets: g.tickets,
        webLinks: g.webLinks,
        count: g.tickets.length,
      }));
    }

    if (groupBy === 'company') {
      const byCompany: Record<string, { tickets: Ticket[]; webLinks: WebLink[]; cases: string[] }> = {};
      for (const g of filteredGroups) {
        const company = g.companyName || 'Unknown';
        if (!byCompany[company]) byCompany[company] = { tickets: [], webLinks: [], cases: [] };
        for (const t of g.tickets) {
          if (!byCompany[company].tickets.some((x) => x.key === t.key))
            byCompany[company].tickets.push(t);
        }
        byCompany[company].webLinks.push(...g.webLinks);
        if (!byCompany[company].cases.includes(g.caseNumber))
          byCompany[company].cases.push(g.caseNumber);
      }
      return Object.entries(byCompany)
        .map(([company, data]) => ({
          key: company,
          label: company,
          sublabel: `${data.cases.length} case(s)`,
          tickets: data.tickets,
          webLinks: data.webLinks,
          count: data.tickets.length,
        }))
        .sort((a, b) => b.count - a.count);
    }

    // groupBy === 'product'
    const byProduct: Record<string, { tickets: Ticket[]; webLinks: WebLink[]; cases: string[] }> = {};
    for (const g of filteredGroups) {
      for (const t of g.tickets) {
        const prod = t.product_name || 'Unknown';
        if (!byProduct[prod]) byProduct[prod] = { tickets: [], webLinks: [], cases: [] };
        if (!byProduct[prod].tickets.some((x) => x.key === t.key))
          byProduct[prod].tickets.push(t);
        byProduct[prod].webLinks.push(...g.webLinks);
        if (!byProduct[prod].cases.includes(g.caseNumber))
          byProduct[prod].cases.push(g.caseNumber);
      }
    }
    return Object.entries(byProduct)
      .map(([product, data]) => ({
        key: product,
        label: product,
        sublabel: `${data.cases.length} case(s)`,
        tickets: data.tickets,
        webLinks: data.webLinks,
        count: data.tickets.length,
      }))
      .sort((a, b) => b.count - a.count);
  }, [filteredGroups, groupBy]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => setExpandedGroups(new Set(displayGroups.map((g) => g.key)));
  const collapseAll = () => setExpandedGroups(new Set());

  /* ── stats ── */
  const totalCases = caseGroups.length;
  const totalTicketsWithCases = new Set(caseGroups.flatMap((g) => g.tickets.map((t) => t.key))).size;
  const multiTicketCases = caseGroups.filter((g) => g.tickets.length > 1).length;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Salesforce Case Tracker
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Tickets grouped by Salesforce Case Number (extracted from Jira web links)
          </Typography>
        </Box>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Card elevation={0} sx={{ border: '1px solid #E5E7EB' }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">Total Cases</Typography>
              <Typography variant="h4" fontWeight={700} color="primary">{totalCases}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card elevation={0} sx={{ border: '1px solid #E5E7EB' }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">Tickets with Cases</Typography>
              <Typography variant="h4" fontWeight={700} color="secondary">{totalTicketsWithCases}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card elevation={0} sx={{ border: '1px solid #E5E7EB' }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">Multi-Ticket Cases</Typography>
              <Typography variant="h4" fontWeight={700} sx={{ color: '#EA580C' }}>{multiTicketCases}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper elevation={0} sx={{ p: 2, mb: 3, border: '1px solid #E5E7EB' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <FilterList fontSize="small" color="action" />
          <Typography variant="subtitle2" fontWeight={600}>Filters</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Search case, company, ticket…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 260 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Status</InputLabel>
            <Select value={statusFilter} label="Status" onChange={(e) => setStatusFilter(e.target.value)}>
              <MenuItem value="all">All Statuses</MenuItem>
              {allStatuses.map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Priority</InputLabel>
            <Select value={priorityFilter} label="Priority" onChange={(e) => setPriorityFilter(e.target.value)}>
              <MenuItem value="all">All Priorities</MenuItem>
              {allPriorities.map((p) => (
                <MenuItem key={p} value={p}>{p}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Product</InputLabel>
            <Select value={productFilter} label="Product" onChange={(e) => setProductFilter(e.target.value)}>
              <MenuItem value="all">All Products</MenuItem>
              {allProducts.map((p) => (
                <MenuItem key={p} value={p}>{p}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>Group by:</Typography>
            <ToggleButtonGroup
              size="small"
              value={groupBy}
              exclusive
              onChange={(_, v) => v && setGroupBy(v)}
            >
              <ToggleButton value="case">
                <Tooltip title="Group by Case Number"><ConfirmationNumber fontSize="small" /></Tooltip>
              </ToggleButton>
              <ToggleButton value="company">
                <Tooltip title="Group by Company"><Business fontSize="small" /></Tooltip>
              </ToggleButton>
              <ToggleButton value="product">
                <Tooltip title="Group by Product"><Category fontSize="small" /></Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Box>
      </Paper>

      {/* Results summary */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Showing {displayGroups.length} group(s) · {filteredGroups.reduce((s, g) => s + g.tickets.length, 0)} ticket(s)
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Chip label="Expand All" size="small" variant="outlined" onClick={expandAll} />
          <Chip label="Collapse All" size="small" variant="outlined" onClick={collapseAll} />
        </Box>
      </Box>

      {/* No data state */}
      {displayGroups.length === 0 && (
        <Paper elevation={0} sx={{ p: 4, textAlign: 'center', border: '1px solid #E5E7EB' }}>
          <FolderOpen sx={{ fontSize: 48, color: '#D1D5DB', mb: 1 }} />
          <Typography variant="h6" color="text.secondary">
            {caseGroups.length === 0
              ? 'No web links found. Click Refresh in Tickets tab to fetch web links from Jira.'
              : 'No results match your filters.'}
          </Typography>
        </Paper>
      )}

      {/* Groups */}
      {displayGroups.map((group) => {
        const isExpanded = expandedGroups.has(group.key);
        return (
          <Paper
            key={group.key}
            elevation={0}
            sx={{ mb: 1.5, border: '1px solid #E5E7EB', overflow: 'hidden' }}
          >
            {/* Group header */}
            <Box
              onClick={() => toggleGroup(group.key)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                px: 2,
                py: 1.5,
                cursor: 'pointer',
                bgcolor: isExpanded ? 'rgba(124, 58, 237, 0.04)' : 'transparent',
                '&:hover': { bgcolor: 'rgba(124, 58, 237, 0.06)' },
                transition: 'background 0.15s',
              }}
            >
              <IconButton size="small">
                {isExpanded ? <ExpandLess /> : <ExpandMore />}
              </IconButton>

              <Badge
                badgeContent={group.count}
                max={9999}
                color="primary"
                sx={{ '& .MuiBadge-badge': { fontSize: '0.7rem' } }}
              >
                <ConfirmationNumber color="action" />
              </Badge>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle1" fontWeight={700} noWrap>
                  {group.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {group.sublabel}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {/* Show unique statuses */}
                {Array.from(new Set(group.tickets.map((t) => t.status))).slice(0, 3).map((s) => (
                  <Chip
                    key={s}
                    label={s}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.68rem',
                      bgcolor: `${statusColor(s)}18`,
                      color: statusColor(s),
                      fontWeight: 600,
                    }}
                  />
                ))}
                {/* Show unique priorities */}
                {Array.from(new Set(group.tickets.map((t) => t.priority))).slice(0, 3).map((p) => (
                  <Chip
                    key={p}
                    label={p}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.68rem',
                      bgcolor: `${priorityColor(p)}18`,
                      color: priorityColor(p),
                      fontWeight: 600,
                    }}
                  />
                ))}
              </Box>
            </Box>

            {/* Expanded content */}
            <Collapse in={isExpanded}>
              <Box sx={{ px: 2, pb: 2 }}>
                {/* Web links section */}
                {group.webLinks && group.webLinks.length > 0 && (
                  <Box sx={{ mb: 2, p: 1.5, bgcolor: '#F9FAFB', borderRadius: 1 }}>
                    <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                      SF Cases ({group.webLinks.length})
                    </Typography>
                    {group.webLinks.slice(0, 10).map((wl, i) => (
                      <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.3 }}>
                        <OpenInNew sx={{ fontSize: 14, color: '#9CA3AF' }} />
                        <Link
                          href={wl.url}
                          target="_blank"
                          rel="noopener"
                          sx={{ fontSize: '0.8rem', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                        >
                          {wl.title || wl.url}
                        </Link>
                      </Box>
                    ))}
                    {group.webLinks.length > 10 && (
                      <Typography variant="caption" color="text.secondary">
                        +{group.webLinks.length - 10} more
                      </Typography>
                    )}
                  </Box>
                )}

                {/* Tickets table */}
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Jira ID</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Summary</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Priority</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Product</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Assignee</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Created</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {group.tickets.map((t) => (
                        <TableRow key={t.key} hover>
                          <TableCell>
                            <Link
                              href={`https://n-able.atlassian.net/browse/${t.key}`}
                              target="_blank"
                              rel="noopener"
                              sx={{ fontWeight: 600, fontSize: '0.8rem', textDecoration: 'none' }}
                            >
                              {t.key}
                            </Link>
                          </TableCell>
                          <TableCell sx={{ maxWidth: 350, fontSize: '0.8rem' }}>
                            <Typography variant="body2" noWrap title={t.summary}>
                              {t.summary}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={t.status}
                              size="small"
                              sx={{
                                height: 22,
                                fontSize: '0.7rem',
                                bgcolor: `${statusColor(t.status)}15`,
                                color: statusColor(t.status),
                                fontWeight: 600,
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={t.priority}
                              size="small"
                              sx={{
                                height: 22,
                                fontSize: '0.7rem',
                                bgcolor: `${priorityColor(t.priority)}15`,
                                color: priorityColor(t.priority),
                                fontWeight: 600,
                              }}
                            />
                          </TableCell>
                          <TableCell sx={{ fontSize: '0.8rem' }}>{t.product_name || '—'}</TableCell>
                          <TableCell sx={{ fontSize: '0.8rem' }}>{t.assignee || '—'}</TableCell>
                          <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                            {t.created ? new Date(t.created).toLocaleDateString() : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </Collapse>
          </Paper>
        );
      })}
    </Box>
  );
};

export default CaseTracker;
