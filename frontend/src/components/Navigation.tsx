import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Box,
  Typography,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  ConfirmationNumber,
  BarChart,
  Settings,
  AccountTree,
  Psychology,
  AutoFixHigh,
  SupportAgent,
  MenuBook,
} from '@mui/icons-material';

const drawerWidth = 220;

// N-able sidebar colours — match N-tranet (#1A1A2E bar, purple accents)
const SIDEBAR_BG   = '#1A1A2E';
const ACTIVE_BG    = 'rgba(124, 58, 237, 0.22)';
const ACTIVE_BAR   = '#7C3AED';
const ICON_DIMMED  = 'rgba(255,255,255,0.50)';
const ICON_ACTIVE  = '#9B6EF3';
const TEXT_DIMMED  = 'rgba(255,255,255,0.65)';
const TEXT_ACTIVE  = '#FFFFFF';
const HOVER_BG     = 'rgba(124, 58, 237, 0.10)';

const menuItems = [
  { text: 'Dashboard',       path: '/',         icon: <DashboardIcon /> },
  { text: 'Tickets',         path: '/tickets',  icon: <ConfirmationNumber /> },
  { text: 'SF Case Tracker',  path: '/case-tracker', icon: <SupportAgent /> },
  { text: 'Grouped Issues',  path: '/grouped',  icon: <AccountTree /> },
  { text: 'Analytics',       path: '/analytics',icon: <BarChart /> },
  { text: 'Root Cause Analyzer', path: '/root-cause-analyzer', icon: <Psychology /> },
  { text: 'Resolution Assistant', path: '/resolution-assistant', icon: <AutoFixHigh /> },
  { text: 'Settings',        path: '/settings', icon: <Settings /> },
];

const Navigation: React.FC = () => {
  const navigate  = useNavigate();
  const location  = useLocation();

  const [confluenceUrl, setConfluenceUrl] = useState<string | null>(null);

  useEffect(() => {
    const loadUrl = () => {
      try {
        const saved = JSON.parse(localStorage.getItem('jiraSettings') || '{}');
        const base = (saved.url || '').replace(/\/+$/, '');
        if (base) setConfluenceUrl(`${base}/wiki`);
        else setConfluenceUrl(null);
      } catch { setConfluenceUrl(null); }
    };
    loadUrl();
    window.addEventListener('jiraSettingsUpdated', loadUrl);
    return () => window.removeEventListener('jiraSettingsUpdated', loadUrl);
  }, []);

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
          bgcolor: SIDEBAR_BG,
          borderRight: 'none',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* spacer to clear fixed AppBar */}
      <Toolbar />

      {/* Section label */}
      <Box sx={{ px: 2.5, pt: 2, pb: 0.5 }}>
        <Typography
          variant="caption"
          sx={{
            color: 'rgba(255,255,255,0.35)',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontSize: '0.65rem',
          }}
        >
          Navigation
        </Typography>
      </Box>

      <List sx={{ pt: 0.5 }}>
        {menuItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <ListItem key={item.text} disablePadding sx={{ display: 'block', mb: 0.5, px: 1 }}>
              <ListItemButton
                onClick={() => navigate(item.path)}
                sx={{
                  borderRadius: 2,
                  py: 1.1,
                  px: 1.5,
                  bgcolor: active ? ACTIVE_BG : 'transparent',
                  borderLeft: active ? `3px solid ${ACTIVE_BAR}` : '3px solid transparent',
                  '&:hover': { bgcolor: active ? ACTIVE_BG : HOVER_BG },
                  transition: 'background 0.15s',
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 36,
                    color: active ? ICON_ACTIVE : ICON_DIMMED,
                    transition: 'color 0.15s',
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.text}
                  primaryTypographyProps={{
                    fontSize: '0.875rem',
                    fontWeight: active ? 700 : 500,
                    color: active ? TEXT_ACTIVE : TEXT_DIMMED,
                  }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>

      {/* Footer branding */}
      <Box sx={{ mt: 'auto', p: 2, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.68rem' }}>
          © {new Date().getFullYear()} N-able. All rights reserved.
        </Typography>
      </Box>
    </Drawer>
  );
};

export default Navigation;