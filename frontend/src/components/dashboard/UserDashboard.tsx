import api from '../../utils/api';
import { useState, useEffect } from 'react';
// i18n removed
import {
  Plus, Clock, CheckCircle, Bell, User, MessageCircle,
  Search, Calendar, X, Shield, Home,
  Inbox, HelpCircle, Menu,
  Bot, Star, AlertCircle, Eye, LogOut, Settings, ChevronDown,
  TrendingUp, BarChart3, Activity, Crown, Zap, RefreshCw, Globe,
  MoreVertical
} from 'lucide-react';
import { ComplaintForm } from '../complaints/ComplaintForm';
import AIAssistant from './AIAssistant';
import { useTranslation } from 'react-i18next';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { useAuth } from '../../hooks/useAuth';
import { useComplaints, Complaint } from '../../contexts/ComplaintContext';
import subscriptionService from '../../services/subscriptionService';
import { DashboardSkeleton, CardSkeleton } from '../common/SkeletonLoader';
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

export function UserDashboard() {
  const { user, logout } = useAuth();
  const { complaints, loading: complaintsContextLoading, refreshComplaints } = useComplaints();
  const [activeView, setActiveView] = useState('dashboard');
  const [filteredComplaints, setFilteredComplaints] = useState<Complaint[]>([]);
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [showChatBot, setShowChatBot] = useState(false);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showSidebarUserMenu, setShowSidebarUserMenu] = useState(false);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const { t, i18n } = useTranslation();

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'zh', name: 'Mandarin Chinese' },
    { code: 'hi', name: 'Hindi' },
    { code: 'es', name: 'Spanish' },
    { code: 'ar', name: 'Standard Arabic' },
    { code: 'fr', name: 'French' },
    { code: 'bn', name: 'Bengali' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ru', name: 'Russian' },
    { code: 'id', name: 'Indonesian' },
    { code: 'ur', name: 'Urdu' },
    { code: 'de', name: 'Standard German' }
  ];

  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code);
    setShowLanguageMenu(false);
  };
  const [userProfile, setUserProfile] = useState({
    name: user?.name || 'User',
    email: user?.email || 'user@example.com',
    phone: '',
    organization: '',
    role: user?.role || 'user',
    joinDate: new Date().toISOString()
  });

  // Handle manual refresh of complaints
  const handleRefreshComplaints = async () => {
    setIsRefreshing(true);
    try {
      await refreshComplaints();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Listen for real-time complaint status updates
  useEffect(() => {
    const handleComplaintUpdated = (event: CustomEvent) => {
      const data = event.detail;
      console.log('📬 Complaint status updated:', data);

      // Check if the updated complaint belongs to this user
      if (data.complaint && user && (data.complaint.userId === user.id || data.complaint.user === user.id)) {
        // Show notification for resolved complaints
        if (data.complaint.status === 'Resolved') {
          alert(`✅ Good News! Your complaint has been resolved!\n\nComplaint ID: ${data.complaint.complaintId || data.complaint._id}\nTitle: ${data.complaint.title}\n\nClick the Refresh button to see the updated status.`);
        }
        // Refresh complaints to get the latest data
        refreshComplaints();
      }
    };

    window.addEventListener('complaintUpdated', handleComplaintUpdated as EventListener);

    return () => {
      window.removeEventListener('complaintUpdated', handleComplaintUpdated as EventListener);
    };
  }, [user, refreshComplaints]);

  // Settings state
  const [settings, setSettings] = useState({
    notifications: {
      email: true,
      sms: false,
      push: true
    },
    security: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    },
    language: 'English (US)',
    timezone: 'GMT-8 (Pacific Time)'
  });

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [upgradingPlan, setUpgradingPlan] = useState<string | null>(null);

  // Search functionality
  const filteredBySearch = filteredComplaints.filter(complaint => {
    const query = searchQuery.toLowerCase();
    return (
      complaint.title?.toLowerCase().includes(query) ||
      complaint.description?.toLowerCase().includes(query) ||
      complaint.complaintId?.toLowerCase().includes(query) ||
      complaint.status?.toLowerCase().includes(query)
    );
  });

  const handleSearchSelect = (complaint: Complaint) => {
    setSelectedComplaint(complaint);
    setShowSearchModal(false);
    setSearchQuery('');
  };
  const [subscriptionError, setSubscriptionError] = useState('');

  // Update user profile when user changes
  useEffect(() => {
    if (user) {
      setUserProfile({
        name: user.name,
        email: user.email,
        phone: '',
        organization: '',
        role: user.role,
        joinDate: new Date().toISOString()
      });
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api.get('/users/profile').then(({ data }) => {
      setUserProfile(previous => ({ ...previous, name: data.name, email: data.email, phone: data.phoneNumber || '', organization: data.organization || '', joinDate: data.createdAt || previous.joinDate }));
      if (data.preferences) setSettings(previous => ({ ...previous, language: data.preferences.language || previous.language, timezone: data.preferences.timezone || previous.timezone, notifications: { email: data.preferences.emailNotifications !== false, sms: data.preferences.smsNotifications === true, push: data.preferences.pushNotifications !== false } }));
    }).catch(() => setSaveError('Unable to load saved profile. Please retry.'));
  }, [user]);

  // Update filtered complaints when complaints change
  useEffect(() => {
    // Use context loading state instead of local loading
    if (complaints && user) {
      // Filter complaints to show only current user's complaints
      // Also match by _id if available
      const userComplaints = complaints.filter(c =>
        c.userId === user.id || c.userId === user._id
      );
      setFilteredComplaints(userComplaints);
      setLoading(complaintsContextLoading);
    } else {
      setLoading(complaintsContextLoading);
    }
  }, [complaints, user, complaintsContextLoading]);

  const handleLogout = () => {
    logout();
    setShowUserMenu(false);
  };

  const handleUpgradePlan = async (planType: 'Pro' | 'Premium') => {
    setUpgradingPlan(planType);
    setSubscriptionError('');

    try {
      // Redirect to Stripe checkout
      await subscriptionService.redirectToCheckout(
        planType,
        (error) => {
          setSubscriptionError(error.message || 'Failed to initiate payment');
          setUpgradingPlan(null);
        }
      );
    } catch (err) {
      setSubscriptionError('Failed to initiate payment');
      console.error('Error upgrading plan:', err);
      setUpgradingPlan(null);
    }
  };

  // Handle profile save
  const handleSaveProfile = async () => {
    setSaveError('');
    setSaveSuccess(false);
    setIsSaving(true);

    try {
      // Validate password fields if changing password
      if (settings.security.newPassword) {
        if (settings.security.newPassword !== settings.security.confirmPassword) {
          setSaveError('Passwords do not match');
          setIsSaving(false);
          return;
        }
        if (settings.security.newPassword.length < 8) {
          setSaveError('Password must be at least 8 characters');
          setIsSaving(false);
          return;
        }
        if (!settings.security.currentPassword) {
          setSaveError('Current password is required to change password');
          setIsSaving(false);
          return;
        }
      }

      await api.patch('/users/profile', {
        name: userProfile.name,
        ...(userProfile.phone ? { phoneNumber: userProfile.phone } : {}),
        organization: userProfile.organization,
        preferences: { emailNotifications: settings.notifications.email, smsNotifications: settings.notifications.sms, pushNotifications: settings.notifications.push, language: settings.language, timezone: settings.timezone }
      });
      if (settings.security.newPassword) {
        await api.patch('/users/password', { currentPassword: settings.security.currentPassword, newPassword: settings.security.newPassword });
        // Password changes revoke existing sessions. Sign in again with the new password.
        await logout();
        return;
      }
      localStorage.setItem('userProfile', JSON.stringify(userProfile));
      localStorage.setItem('userSettings', JSON.stringify({ ...settings, security: { currentPassword: '', newPassword: '', confirmPassword: '' } }));

      setSaveSuccess(true);
      setIsSaving(false);

      // Reset password fields
      setSettings(prev => ({
        ...prev,
        security: {
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        }
      }));

      // Hide success message after 3 seconds
      setTimeout(() => {
        setSaveSuccess(false);
      }, 3000);

    } catch (error) {
      setSaveError('Failed to save settings. Please try again.');
      setIsSaving(false);
      console.error('Save error:', error);
    }
  };

  // Handle photo upload
  const handlePhotoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setSaveError('Image size must be less than 5MB');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setProfilePhoto(result);
        localStorage.setItem('userProfilePhoto', result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle photo removal
  const handlePhotoRemove = () => {
    setProfilePhoto(null);
    localStorage.removeItem('userProfilePhoto');
  };

  // Load saved settings on mount
  useEffect(() => {
    const savedProfile = localStorage.getItem('userProfile');
    const savedSettings = localStorage.getItem('userSettings');
    const savedPhoto = localStorage.getItem('userProfilePhoto');

    if (savedProfile) {
      try {
        const parsed = JSON.parse(savedProfile);
        setUserProfile(prev => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error('Failed to parse saved profile:', e);
      }
    }

    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setSettings(prev => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error('Failed to parse saved settings:', e);
      }
    }

    if (savedPhoto) {
      setProfilePhoto(savedPhoto);
    }
  }, []);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (showUserMenu && !target.closest('.user-menu-container')) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  // Calculate statistics from real data
  const stats = {
    total: filteredComplaints.length,
    open: filteredComplaints.filter(c => c.status === 'Open').length,
    inProgress: filteredComplaints.filter(c => c.status === 'In Progress' || c.status === 'Under Review').length,
    resolved: filteredComplaints.filter(c => c.status === 'Resolved' || c.status === 'Closed').length,
    escalated: filteredComplaints.filter(c => c.status === 'Escalated').length,
    urgent: filteredComplaints.filter(c => c.priority === 'High' || c.priority === 'Urgent').length,
    thisWeek: filteredComplaints.filter(c => {
      const createdDate = new Date(c.createdAt);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return createdDate >= weekAgo;
    }).length,
    avgResponseTime: '2.5h'
  };

  // Prepare chart data - Status Distribution for Pie Chart
  const statusChartData = [
    { name: 'Open', value: stats.open, color: '#3B82F6' },
    { name: 'In Progress', value: stats.inProgress, color: '#F59E0B' },
    { name: 'Resolved', value: stats.resolved, color: '#10B981' },
    { name: 'Escalated', value: stats.escalated, color: '#EF4444' }
  ].filter(item => item.value > 0);

  // Prepare trend data for Line Chart (last 7 days)
  const getTrendData = () => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      const created = filteredComplaints.filter(c => {
        const complaintDate = new Date(c.createdAt);
        return complaintDate.toDateString() === date.toDateString();
      }).length;

      const resolved = filteredComplaints.filter(c => {
        const complaintDate = new Date(c.updatedAt || c.createdAt);
        return complaintDate.toDateString() === date.toDateString() &&
          (c.status === 'Resolved' || c.status === 'Closed');
      }).length;

      days.push({ date: dateStr, created, resolved });
    }
    return days;
  };

  const trendData = getTrendData();

  // Define distinct colors for each category
  const categoryColors: Record<string, string> = {
    'Technical': '#3B82F6',   // Blue
    'Billing': '#10B981',     // Green
    'Service': '#F59E0B',     // Amber
    'Product': '#8B5CF6',     // Purple
    'General': '#EF4444',     // Red
    'Support': '#06B6D4',     // Cyan
    'Account': '#EC4899',     // Pink
    'Delivery': '#14B8A6',    // Teal
    'Quality': '#F97316',     // Orange
    'Other': '#6B7280'        // Gray
  };

  // Prepare category data for Bar Chart with distinct colors
  const categoryData = [
    { category: 'Technical', count: filteredComplaints.filter(c => c.category === 'Technical').length, fill: categoryColors['Technical'] },
    { category: 'Billing', count: filteredComplaints.filter(c => c.category === 'Billing').length, fill: categoryColors['Billing'] },
    { category: 'Service', count: filteredComplaints.filter(c => c.category === 'Service').length, fill: categoryColors['Service'] },
    { category: 'Product', count: filteredComplaints.filter(c => c.category === 'Product').length, fill: categoryColors['Product'] },
    { category: 'General', count: filteredComplaints.filter(c => c.category === 'General').length, fill: categoryColors['General'] }
  ].filter(item => item.count > 0);

  // Prepare priority data
  const priorityData = [
    { name: 'Low', value: filteredComplaints.filter(c => c.priority === 'Low').length, color: '#10B981' },
    { name: 'Medium', value: filteredComplaints.filter(c => c.priority === 'Medium').length, color: '#F59E0B' },
    { name: 'High', value: filteredComplaints.filter(c => c.priority === 'High' || c.priority === 'Urgent').length, color: '#EF4444' }
  ].filter(item => item.value > 0);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Resolved':
      case 'Closed':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'In Progress':
      case 'Under Review':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'Escalated':
        return 'bg-red-100 text-red-700 border-red-200';
      case 'Open':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'High':
      case 'Urgent':
        return 'text-red-600 bg-red-50';
      case 'Medium':
        return 'text-yellow-600 bg-yellow-50';
      case 'Low':
        return 'text-green-600 bg-green-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile backdrop overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Premium Dark Sidebar — translate-x drawer on mobile, always fixed on lg+ */}
      <div className={`bg-[#0f172a] flex flex-col transition-all duration-300 ease-in-out fixed left-0 top-0 h-screen z-40 border-r border-slate-800
        ${sidebarCollapsed ? 'lg:w-20 w-64' : 'w-64'}
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo Section */}
        <div className="p-6">
          <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <div className="w-10 h-10 bg-[#22c55e] rounded-xl flex items-center justify-center flex-shrink-0">
              <Shield className="w-6 h-6 text-white" />
            </div>
            {!sidebarCollapsed && (
              <span className="text-white font-bold text-2xl tracking-tight">QuickFix</span>
            )}
          </div>
        </div>

        {/* Navigation Section */}
        <div
          className="flex-1 px-3 space-y-1 overflow-y-auto"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <style dangerouslySetInnerHTML={{
            __html: `
            .overflow-y-auto::-webkit-scrollbar {
              display: none;
            }
          `}} />
          <button
            onClick={() => setActiveView('dashboard')}
            className={`w-full h-12 rounded-xl flex items-center ${sidebarCollapsed ? 'justify-center' : 'px-4'} gap-3 transition-all duration-200 group ${activeView === 'dashboard'
              ? 'bg-[#1e293b] text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
          >
            <Home className={`w-5 h-5 flex-shrink-0 ${activeView === 'dashboard' ? 'text-blue-400' : 'group-hover:text-blue-400'}`} />
            {!sidebarCollapsed && <span className="text-sm font-semibold">{t('common.dashboard')}</span>}
          </button>

          <button
            onClick={() => setActiveView('complaints')}
            className={`w-full h-12 rounded-xl flex items-center ${sidebarCollapsed ? 'justify-center' : 'px-4'} gap-3 transition-all duration-200 group ${activeView === 'complaints'
              ? 'bg-[#1e293b] text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
          >
            <Clock className={`w-5 h-5 flex-shrink-0 ${activeView === 'complaints' ? 'text-blue-400' : 'group-hover:text-blue-400'}`} />
            {!sidebarCollapsed && <span className="text-sm font-semibold">{t('common.myTickets')}</span>}
          </button>

          <button
            onClick={() => setActiveView('new-complaint')}
            className={`w-full h-12 rounded-xl flex items-center ${sidebarCollapsed ? 'justify-center' : 'px-4'} gap-3 transition-all duration-200 group ${activeView === 'new-complaint'
              ? 'bg-[#1e293b] text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
          >
            <Plus className={`w-5 h-5 flex-shrink-0 ${activeView === 'new-complaint' ? 'text-blue-400' : 'group-hover:text-blue-400'}`} />
            {!sidebarCollapsed && <span className="text-sm font-semibold">{t('common.newTicket')}</span>}
          </button>

          <button
            onClick={() => setActiveView('profile')}
            className={`w-full h-12 rounded-xl flex items-center ${sidebarCollapsed ? 'justify-center' : 'px-4'} gap-3 transition-all duration-200 group ${activeView === 'profile'
              ? 'bg-[#1e293b] text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
          >
            <User className={`w-5 h-5 flex-shrink-0 ${activeView === 'profile' ? 'text-blue-400' : 'group-hover:text-blue-400'}`} />
            {!sidebarCollapsed && <span className="text-sm font-semibold">{t('common.profile')}</span>}
          </button>

          <button
            onClick={() => setShowNotifications(true)}
            className={`w-full h-12 rounded-xl flex items-center ${sidebarCollapsed ? 'justify-center' : 'px-4'} gap-3 text-slate-400 hover:text-white hover:bg-slate-800/50 transition-all duration-200 group`}
          >
            <Bell className="w-5 h-5 flex-shrink-0 group-hover:text-blue-400" />
            {!sidebarCollapsed && <span className="text-sm font-semibold">{t('common.notifications')}</span>}
          </button>

          <button
            onClick={() => setShowChatBot(true)}
            className={`w-full h-12 rounded-xl flex items-center ${sidebarCollapsed ? 'justify-center' : 'px-4'} gap-3 text-slate-400 hover:text-white hover:bg-slate-800/50 transition-all duration-200 group`}
          >
            <Bot className="w-5 h-5 flex-shrink-0 group-hover:text-blue-400" />
            {!sidebarCollapsed && <span className="text-sm font-semibold">{t('common.aiAssistant')}</span>}
          </button>

          <button
            className={`w-full h-12 rounded-xl flex items-center ${sidebarCollapsed ? 'justify-center' : 'px-4'} gap-3 text-slate-400 hover:text-white hover:bg-slate-800/50 transition-all duration-200 group`}
          >
            <HelpCircle className="w-5 h-5 flex-shrink-0 group-hover:text-blue-400" />
            {!sidebarCollapsed && <span className="text-sm font-semibold flex-1 text-left">{t('common.help')}</span>}
            {!sidebarCollapsed && <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-500 font-mono">⌘J</span>}
          </button>

          {/* Upgrade Card */}
          <div className="pt-4 mt-4 border-t border-slate-800/50">
            <button
              onClick={() => setActiveView('profile')}
              className={`w-full rounded-xl flex items-center ${sidebarCollapsed ? 'justify-center p-2' : 'px-4 py-3'} gap-3 bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/20 transition-all duration-200 border border-[#f59e0b]/20 group`}
            >
              <Crown className="w-5 h-5 flex-shrink-0" />
              {!sidebarCollapsed && <span className="text-sm font-bold uppercase tracking-wider">{t('common.upgrade')}</span>}
            </button>
          </div>
        </div>

        {/* User Card Footer */}
        <div className="p-4 border-t border-slate-800/50 bg-[#0f172a] relative">
          {showSidebarUserMenu && (
            <div className={`absolute bottom-full left-4 mb-2 w-56 bg-[#1e293b] border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden transition-all duration-200`}>
              <div className="p-2">
                <button
                  onClick={() => {
                    setActiveView('profile');
                    setShowSidebarUserMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <User className="w-4 h-4" />
                  My Profile
                </button>
                <button
                  onClick={() => {
                    handleLogout();
                    setShowSidebarUserMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}

          <button
            onClick={() => setShowSidebarUserMenu(!showSidebarUserMenu)}
            className={`w-full rounded-xl flex items-center ${sidebarCollapsed ? 'justify-center h-12' : 'px-3 py-3'} gap-3 text-slate-400 hover:text-white hover:bg-slate-800/50 transition-all duration-200 group border border-transparent hover:border-slate-700/50`}
          >
            <div className="relative flex-shrink-0">
              {profilePhoto || user?.photoURL ? (
                <img
                  src={profilePhoto || user?.photoURL}
                  alt="User"
                  className="w-8 h-8 rounded-full object-cover ring-2 ring-slate-800 group-hover:ring-slate-700 transition-all"
                />
              ) : (
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-xs ring-2 ring-slate-800 group-hover:ring-slate-700 transition-all">
                  {userProfile.name?.charAt(0).toUpperCase() || 'U'}
                </div>
              )}
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-[#0f172a] rounded-full"></div>
            </div>

            {!sidebarCollapsed && (
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-bold text-slate-200 truncate">{userProfile.name}</p>
                <p className="text-[10px] text-slate-500 truncate font-medium uppercase tracking-wider">{userProfile.role}</p>
              </div>
            )}

            {!sidebarCollapsed && (
              <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${showSidebarUserMenu ? 'rotate-180' : ''}`} />
            )}
          </button>
        </div>
      </div>

      {/* Main Content Area - Adjusted for Fixed Sidebar */}
      <div className={`flex flex-col min-h-screen transition-all duration-300 ${sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'}`}>
        {/* Freshdesk-style Clean Header */}
        <header className="bg-white border-b border-gray-200 px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={() => {
                if (window.innerWidth >= 1024) {
                  setSidebarCollapsed(!sidebarCollapsed);
                } else {
                  setMobileMenuOpen(!mobileMenuOpen);
                }
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              title="Toggle menu"
            >
              <Menu className="w-5 h-5 text-gray-600" />
            </button>
            <h1 className="text-base sm:text-xl font-semibold text-gray-900 truncate">
              {activeView === 'dashboard' && 'User Dashboard'}
              {activeView === 'complaints' && 'My Complaints'}
              {activeView === 'new-complaint' && 'File New Complaint'}
              {activeView === 'profile' && 'Profile Management'}
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleRefreshComplaints}
              disabled={isRefreshing}
              className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-200 flex items-center gap-1.5 disabled:opacity-50 text-sm font-medium transition-colors"
              title={t('common.refresh')}
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? `${t('common.refresh')}...` : t('common.refresh')}
            </button>

            <button
              onClick={() => setActiveView('new-complaint')}
              className="text-slate-800 hover:text-slate-900 font-medium text-sm flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg"
            >
              <Plus className="w-4 h-4" />
              {t('common.newTicket')}
            </button>

            {/* Language Switcher */}
            <div className="relative">
              <button
                onClick={() => setShowLanguageMenu(!showLanguageMenu)}
                className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg flex items-center gap-2"
                title="Change Language"
              >
                <Globe className="w-5 h-5" />
                <span className="text-xs font-semibold uppercase">{i18n.language.split('-')[0]}</span>
              </button>

              {showLanguageMenu && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-2xl border border-gray-100 z-[60] py-2 animate-in fade-in slide-in-from-top-2">
                  <div className="px-4 py-2 border-b border-gray-50 mb-1">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Select Language</p>
                  </div>
                  <div className="max-h-96 overflow-y-auto custom-scrollbar">
                    {languages.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => changeLanguage(lang.code)}
                        className={`w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors ${i18n.language === lang.code ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                          }`}
                      >
                        <div>
                          <p className="text-sm font-bold">{lang.name}</p>
                        </div>
                        {i18n.language === lang.code && <CheckCircle className="w-4 h-4 text-blue-600" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => setShowSearchModal(true)}
              className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg"
              title="Search Complaints"
            >
              <Search className="w-5 h-5" />
            </button>

            <button
              onClick={() => setShowNotifications(true)}
              className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg relative"
            >
              <Bell className="w-5 h-5" />
              {stats.open > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {stats.open}
                </span>
              )}
            </button>

            <button className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg">
              <HelpCircle className="w-5 h-5" />
            </button>

            <div className="relative user-menu-container">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 sm:gap-3 hover:bg-gray-50 rounded-lg p-2 transition-colors"
              >
                {/* Desktop: Show Image/Initials */}
                <div className="hidden sm:block">
                  {profilePhoto ? (
                    <img src={profilePhoto} alt="Profile" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                      {userProfile.name?.charAt(0).toUpperCase() || 'U'}
                    </div>
                  )}
                </div>
                {/* Mobile: Show simple user icon */}
                <div className="sm:hidden w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                  <User className="w-4 h-4 text-gray-600" />
                </div>
                
                <div className="text-left hidden sm:block">
                  <p className="text-sm font-medium text-gray-900">{userProfile.name}</p>
                  <p className="text-xs text-gray-500">{userProfile.role}</p>
                </div>
                <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
              </button>

              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                  <div className="p-4 border-b border-gray-100">
                    <p className="font-semibold text-gray-900">{userProfile.name}</p>
                    <p className="text-sm text-blue-600 truncate" title={userProfile.email}>{userProfile.email}</p>
                    <p className="text-sm text-gray-500 mt-1">Role: {userProfile.role}</p>
                  </div>
                  <div className="p-2">
                    <button
                      onClick={() => {
                        setActiveView('profile');
                        setShowUserMenu(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md flex items-center gap-3"
                    >
                      <Settings className="w-4 h-4 text-gray-500" />
                      Account Settings
                    </button>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md flex items-center gap-3"
                    >
                      <LogOut className="w-4 h-4 text-gray-500" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header >

        {/* Dashboard View - Core Complaint Features */}
        {loading ? (
          <DashboardSkeleton />
        ) : (
          <>
            {activeView === 'dashboard' && (
              <div className="flex flex-col xl:flex-row bg-gray-50 min-h-screen">
                {/* Main Content Area */}
                <div className="flex-1 p-3 sm:p-4 md:p-6 w-full">
                  {/* Welcome Section */}
                  <div className="mb-6">
                    <h2 className="text-2xl font-semibold text-gray-900 mb-1">{t('common.welcome')}, {userProfile.name}</h2>
                    <p className="text-gray-600">{t('common.dashboardOverview') || "Here's an overview of your tickets"}</p>
                  </div>

                  {/* Clean Stats Cards - Text Only Style */}
                  <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-4 sm:mb-6">
                    <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                      <p className="text-sm text-gray-600 mb-2">{t('common.totalComplaints')}</p>
                      <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
                      <p className="text-xs text-gray-500 mt-1">{t('common.allTime')}</p>
                    </div>

                    <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                      <p className="text-sm text-gray-600 mb-2">{t('common.open')}</p>
                      <div className="text-3xl font-bold text-blue-600">{stats.open}</div>
                      <p className="text-xs text-gray-500 mt-1">{t('common.needsAttention')}</p>
                    </div>

                    <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                      <p className="text-sm text-gray-600 mb-2">{t('common.inProgress')}</p>
                      <div className="text-3xl font-bold text-yellow-600">{stats.inProgress}</div>
                      <p className="text-xs text-gray-500 mt-1">{t('common.beingProcessed')}</p>
                    </div>

                    <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                      <p className="text-sm text-gray-600 mb-2">{t('common.resolved')}</p>
                      <div className="text-3xl font-bold text-green-600">{stats.resolved}</div>
                      <p className="text-xs text-gray-500 mt-1">{t('common.completed')}</p>
                    </div>

                    <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                      <p className="text-sm text-gray-600 mb-2">{t('common.urgent')}</p>
                      <div className="text-3xl font-bold text-orange-600">{stats.urgent}</div>
                      <p className="text-xs text-gray-500 mt-1">{t('common.highPriority')}</p>
                    </div>

                    <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                      <p className="text-sm text-gray-600 mb-2">{t('common.escalated')}</p>
                      <div className="text-3xl font-bold text-red-600">{stats.escalated}</div>
                      <p className="text-xs text-gray-500 mt-1">{t('common.needsReview')}</p>
                    </div>
                  </div>

                  {/* Analytics Charts Section - Freshdesk Style */}
                  {filteredComplaints.length > 0 && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
                      {/* Status Distribution Pie Chart */}
                      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-gray-900">Status Distribution</h3>
                          <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                            <Activity className="w-4 h-4 text-blue-600" />
                          </div>
                        </div>
                        <ResponsiveContainer width="100%" height={250}>
                          <PieChart>
                            <Pie
                              data={statusChartData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, percent }) => `${name} ${percent ? (percent * 100).toFixed(0) : 0}%`}
                              outerRadius={80}
                              fill="#8884d8"
                              dataKey="value"
                            >
                              {statusChartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {statusChartData.map((item) => (
                            <div key={item.name} className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                              <span className="text-sm text-gray-600">{item.name}: {item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Priority Distribution Pie Chart */}
                      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-gray-900">Priority Levels</h3>
                          <div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center">
                            <AlertCircle className="w-4 h-4 text-orange-600" />
                          </div>
                        </div>
                        <ResponsiveContainer width="100%" height={250}>
                          <PieChart>
                            <Pie
                              data={priorityData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, percent }) => `${name} ${percent ? (percent * 100).toFixed(0) : 0}%`}
                              outerRadius={80}
                              fill="#8884d8"
                              dataKey="value"
                            >
                              {priorityData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                          {priorityData.map((item) => (
                            <div key={item.name} className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                              <span className="text-sm text-gray-600">{item.name}: {item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Tickets Trend Line Chart */}
                      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-gray-900">7-Day Trend</h3>
                          <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center">
                            <TrendingUp className="w-4 h-4 text-green-600" />
                          </div>
                        </div>
                        <ResponsiveContainer width="100%" height={250}>
                          <LineChart data={trendData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#6b7280" />
                            <YAxis tick={{ fontSize: 12 }} stroke="#6b7280" />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'white',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                fontSize: '12px'
                              }}
                            />
                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                            <Line
                              type="monotone"
                              dataKey="created"
                              stroke="#3B82F6"
                              strokeWidth={2}
                              name="Created"
                              dot={{ fill: '#3B82F6', r: 4 }}
                            />
                            <Line
                              type="monotone"
                              dataKey="resolved"
                              stroke="#10B981"
                              strokeWidth={2}
                              name="Resolved"
                              dot={{ fill: '#10B981', r: 4 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Category Distribution Bar Chart */}
                      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-gray-900">By Category</h3>
                          <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center">
                            <BarChart3 className="w-4 h-4 text-purple-600" />
                          </div>
                        </div>
                        <ResponsiveContainer width="100%" height={250}>
                          <BarChart data={categoryData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="category" tick={{ fontSize: 12 }} stroke="#6b7280" />
                            <YAxis tick={{ fontSize: 12 }} stroke="#6b7280" />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'white',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                fontSize: '12px'
                              }}
                            />
                            <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                              {categoryData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.fill} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Main Content Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                    {/* Recent Complaints - Clean Freshdesk Style */}
                    <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200">
                      <div className="p-5 border-b border-gray-200 flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-gray-900">Recent Tickets</h3>
                        <button
                          onClick={() => setActiveView('complaints')}
                          className="text-slate-800 hover:text-slate-900 text-sm font-medium"
                        >
                          View all
                        </button>
                      </div>
                      <div className="p-5">
                        {loading ? (
                          <CardSkeleton count={3} />
                        ) : filteredComplaints.length === 0 ? (
                          <div className="text-center py-12 text-gray-500">
                            <Inbox className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                            <p className="text-base font-medium text-gray-700 mb-1">No tickets yet</p>
                            <p className="text-sm text-gray-500 mb-4">Create your first ticket to get started</p>
                            <button
                              onClick={() => setActiveView('new-complaint')}
                              className="bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-700 text-sm font-medium"
                            >
                              Create Ticket
                            </button>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="border-b border-gray-100 text-[15px] font-semibold text-gray-900 bg-white">
                                  <th className="py-4 px-4 font-semibold whitespace-nowrap">Ticket ID</th>
                                  <th className="py-4 px-4 font-semibold">Subject</th>
                                  <th className="py-4 px-4 font-semibold">Customer</th>
                                  <th className="py-4 px-4 font-semibold">Priority</th>
                                  <th className="py-4 px-4 font-semibold">Status</th>
                                  <th className="py-4 px-4 font-semibold">Assignee</th>
                                  <th className="py-4 px-4 font-semibold">Updated</th>
                                  <th className="py-4 px-4"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {filteredComplaints.slice(0, 5).map((complaint) => {
                                  const getUpdatedTime = (d: any) => {
                                    if (!d) return '';
                                    const secs = Math.floor((new Date().getTime() - new Date(d).getTime()) / 1000);
                                    if (secs < 60) return 'Just now';
                                    const mins = Math.floor(secs / 60);
                                    if (mins < 60) return `${mins} min ago`;
                                    const hrs = Math.floor(mins / 60);
                                    if (hrs < 24) return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
                                    const days = Math.floor(hrs / 24);
                                    if (days === 1) return 'Yesterday';
                                    if (days < 30) return `${days} days ago`;
                                    return new Date(d).toLocaleDateString();
                                  };

                                  return (
                                    <tr 
                                      key={complaint.id} 
                                      className="hover:bg-gray-50 cursor-pointer transition-colors bg-white group"
                                      onClick={() => setSelectedComplaint(complaint)}
                                    >
                                      <td className="py-4 px-4">
                                        <span className="text-[15px] font-semibold text-gray-800">
                                          {complaint.complaintId || complaint.id.substring(0, 8)}
                                        </span>
                                      </td>
                                      <td className="py-4 px-4">
                                        <span className="text-[15px] font-medium text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-1">{complaint.title}</span>
                                      </td>
                                      <td className="py-4 px-4">
                                        <div className="flex flex-col">
                                          <span className="text-[15px] font-medium text-gray-900 whitespace-nowrap">{user?.name || 'Customer'}</span>
                                          <span className="text-[13px] text-gray-500 whitespace-nowrap">{user?.email || ''}</span>
                                        </div>
                                      </td>
                                      <td className="py-4 px-4">
                                        <span className={`inline-flex items-center justify-center px-3 py-1 text-xs font-semibold rounded-full border ${
                                          complaint.priority === 'Urgent' ? 'bg-[#C1121F] text-white border-[#C1121F]' :
                                          complaint.priority === 'High' ? 'bg-[#111827] text-white border-[#111827]' :
                                          complaint.priority === 'Medium' ? 'bg-[#F3F4F6] text-gray-700 border-gray-200' :
                                          'bg-white text-gray-700 border-gray-200'
                                        }`}>
                                          {complaint.priority}
                                        </span>
                                      </td>
                                      <td className="py-4 px-4">
                                        <span className={`inline-flex items-center justify-center px-3 py-1 text-xs font-medium rounded-full border whitespace-nowrap ${
                                          complaint.status === 'Open' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                                          complaint.status === 'In Progress' ? 'bg-orange-50 text-orange-600 border-orange-100' :
                                          (complaint.status as string) === 'Pending' ? 'bg-yellow-50 text-yellow-600 border-yellow-100' :
                                          complaint.status === 'Resolved' ? 'bg-green-50 text-green-600 border-green-100' :
                                          'bg-gray-50 text-gray-600 border-gray-100'
                                        }`}>
                                          {complaint.status}
                                        </span>
                                      </td>
                                      <td className="py-4 px-4">
                                        <span className="text-[15px] text-gray-700 whitespace-nowrap">
                                          {(complaint as any).assignedAgency?.name || (complaint as any).assignedAgent?.name || 'Unassigned'}
                                        </span>
                                      </td>
                                      <td className="py-4 px-4">
                                        <span className="text-[15px] text-gray-500 whitespace-nowrap">
                                          {getUpdatedTime(complaint.updatedAt || complaint.createdAt)}
                                        </span>
                                      </td>
                                      <td className="py-4 px-4 text-right">
                                        <button 
                                          className="text-gray-400 hover:text-gray-700 p-1 rounded-md hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedComplaint(complaint);
                                          }}
                                        >
                                          <MoreVertical className="w-5 h-5" />
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Quick Actions - Clean Style */}
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                      <div className="p-5 border-b border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900">Quick Actions</h3>
                      </div>
                      <div className="p-5">
                        <div className="space-y-2">
                          <button
                            onClick={() => setActiveView('new-complaint')}
                            className="w-full flex items-center gap-3 p-3 text-left border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors"
                          >
                            <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                              <Plus className="w-5 h-5 text-slate-800" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-gray-900 text-sm">New Ticket</h4>
                              <p className="text-xs text-gray-600">Create a new ticket</p>
                            </div>
                          </button>

                          <button
                            onClick={() => setActiveView('complaints')}
                            className="w-full flex items-center gap-3 p-3 text-left border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors"
                          >
                            <div className="w-9 h-9 bg-green-50 rounded-lg flex items-center justify-center flex-shrink-0">
                              <Inbox className="w-5 h-5 text-green-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-gray-900 text-sm">My Tickets</h4>
                              <p className="text-xs text-gray-600">View all tickets</p>
                            </div>
                          </button>

                          <button
                            onClick={() => setActiveView('profile')}
                            className="w-full flex items-center gap-3 p-3 text-left border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors"
                          >
                            <div className="w-9 h-9 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0">
                              <User className="w-5 h-5 text-purple-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-gray-900 text-sm">Profile</h4>
                              <p className="text-xs text-gray-600">Manage account</p>
                            </div>
                          </button>

                          <button
                            onClick={() => setShowChatBot(true)}
                            className="w-full flex items-center gap-3 p-3 text-left border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors"
                          >
                            <div className="w-9 h-9 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0">
                              <Bot className="w-5 h-5 text-orange-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-gray-900 text-sm">Support</h4>
                              <p className="text-xs text-gray-600">Get help</p>
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Status Legend - Clean Style */}
                  <div className="mt-6 bg-white rounded-lg shadow-sm border border-gray-200">
                    <div className="p-5 border-b border-gray-200">
                      <h3 className="text-base font-semibold text-gray-900">Ticket Status Guide</h3>
                    </div>
                    <div className="p-5">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
                          <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                          <div>
                            <p className="font-medium text-gray-900 text-sm">Open</p>
                            <p className="text-xs text-gray-600">New tickets</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
                          <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                          <div>
                            <p className="font-medium text-gray-900 text-sm">In Progress</p>
                            <p className="text-xs text-gray-600">Under review</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
                          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                          <div>
                            <p className="font-medium text-gray-900 text-sm">Resolved</p>
                            <p className="text-xs text-gray-600">Completed</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
                          <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                          <div>
                            <p className="font-medium text-gray-900 text-sm">Closed</p>
                            <p className="text-xs text-gray-600">No further action</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Side Promotional Panel */}
                <div className="w-full xl:w-80 p-3 sm:p-4 md:p-6 xl:pl-0">
                  <div className="sticky top-6">
                    <div className="rounded-xl shadow-lg overflow-hidden border border-gray-100 cursor-pointer hover:shadow-xl transition-shadow duration-300">
                      <img
                        src="/quickfix-promo.png?v=2"
                        alt="QuickFix Features - What's in it for you?"
                        className="w-full h-auto object-contain"
                        onClick={() => setActiveView('profile')}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* Clean Complaints List View */}
            {activeView === 'complaints' && (
              <div className="p-3 sm:p-4 md:p-6 bg-gray-50 min-h-screen">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                  <div className="p-5 border-b border-gray-200 flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900">My Tickets</h3>
                      <p className="text-sm text-gray-600 mt-0.5">View and manage all your tickets</p>
                    </div>
                    <button
                      onClick={() => setActiveView('new-complaint')}
                      className="bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-700 flex items-center gap-2 text-sm font-medium"
                    >
                      <Plus className="w-4 h-4" />
                      New Ticket
                    </button>
                  </div>
                  <div className="p-5">
                    {filteredComplaints.length === 0 ? (
                      <div className="text-center py-12">
                        <Inbox className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <p className="text-lg font-semibold text-gray-800 mb-2">No tickets found</p>
                        <p className="text-gray-600 mb-6 text-sm">You haven't created any tickets yet</p>
                        <button
                          onClick={() => setActiveView('new-complaint')}
                          className="bg-slate-800 text-white px-6 py-2.5 rounded-lg hover:bg-slate-700 text-sm font-medium"
                        >
                          Create Your First Ticket
                        </button>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-gray-100 text-[15px] font-semibold text-gray-900 bg-white">
                              <th className="py-4 px-4 font-semibold whitespace-nowrap">Ticket ID</th>
                              <th className="py-4 px-4 font-semibold">Subject</th>
                              <th className="py-4 px-4 font-semibold">Customer</th>
                              <th className="py-4 px-4 font-semibold">Priority</th>
                              <th className="py-4 px-4 font-semibold">Status</th>
                              <th className="py-4 px-4 font-semibold">Assignee</th>
                              <th className="py-4 px-4 font-semibold">Updated</th>
                              <th className="py-4 px-4"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {filteredComplaints.map((complaint) => {
                              const getUpdatedTime = (d: any) => {
                                if (!d) return '';
                                const secs = Math.floor((new Date().getTime() - new Date(d).getTime()) / 1000);
                                if (secs < 60) return 'Just now';
                                const mins = Math.floor(secs / 60);
                                if (mins < 60) return `${mins} min ago`;
                                const hrs = Math.floor(mins / 60);
                                if (hrs < 24) return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
                                const days = Math.floor(hrs / 24);
                                if (days === 1) return 'Yesterday';
                                if (days < 30) return `${days} days ago`;
                                return new Date(d).toLocaleDateString();
                              };

                              return (
                                <tr 
                                  key={complaint.id} 
                                  className="hover:bg-gray-50 cursor-pointer transition-colors bg-white group"
                                  onClick={() => setSelectedComplaint(complaint)}
                                >
                                  <td className="py-4 px-4">
                                    <span className="text-[15px] font-semibold text-gray-800">
                                      {complaint.complaintId || complaint.id.substring(0, 8)}
                                    </span>
                                  </td>
                                  <td className="py-4 px-4">
                                    <span className="text-[15px] font-medium text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-1">{complaint.title}</span>
                                  </td>
                                  <td className="py-4 px-4">
                                    <div className="flex flex-col">
                                      <span className="text-[15px] font-medium text-gray-900 whitespace-nowrap">{user?.name || 'Customer'}</span>
                                      <span className="text-[13px] text-gray-500 whitespace-nowrap">{user?.email || ''}</span>
                                    </div>
                                  </td>
                                  <td className="py-4 px-4">
                                    <span className={`inline-flex items-center justify-center px-3 py-1 text-xs font-semibold rounded-full border ${
                                      complaint.priority === 'Urgent' ? 'bg-[#C1121F] text-white border-[#C1121F]' :
                                      complaint.priority === 'High' ? 'bg-[#111827] text-white border-[#111827]' :
                                      complaint.priority === 'Medium' ? 'bg-[#F3F4F6] text-gray-700 border-gray-200' :
                                      'bg-white text-gray-700 border-gray-200'
                                    }`}>
                                      {complaint.priority}
                                    </span>
                                  </td>
                                  <td className="py-4 px-4">
                                    <span className={`inline-flex items-center justify-center px-3 py-1 text-xs font-medium rounded-full border whitespace-nowrap ${
                                      complaint.status === 'Open' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                                      complaint.status === 'In Progress' ? 'bg-orange-50 text-orange-600 border-orange-100' :
                                      (complaint.status as string) === 'Pending' ? 'bg-yellow-50 text-yellow-600 border-yellow-100' :
                                      complaint.status === 'Resolved' ? 'bg-green-50 text-green-600 border-green-100' :
                                      'bg-gray-50 text-gray-600 border-gray-100'
                                    }`}>
                                      {complaint.status}
                                    </span>
                                  </td>
                                  <td className="py-4 px-4">
                                    <span className="text-[15px] text-gray-700 whitespace-nowrap">
                                      {(complaint as any).assignedAgency?.name || (complaint as any).assignedAgent?.name || 'Unassigned'}
                                    </span>
                                  </td>
                                  <td className="py-4 px-4">
                                    <span className="text-[15px] text-gray-500 whitespace-nowrap">
                                      {getUpdatedTime(complaint.updatedAt || complaint.createdAt)}
                                    </span>
                                  </td>
                                  <td className="py-4 px-4 text-right">
                                    <button 
                                      className="text-gray-400 hover:text-gray-700 p-1 rounded-md hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedComplaint(complaint);
                                      }}
                                    >
                                      <MoreVertical className="w-5 h-5" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* New Complaint View */}
            {activeView === 'new-complaint' && (
              <div className="p-3 sm:p-4 md:p-6 bg-gray-50 min-h-screen">
                <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200">
                  <div className="p-5 border-b border-gray-200 flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900">Create New Ticket</h3>
                      <p className="text-sm text-gray-600 mt-0.5">Fill in the details to create a new support ticket</p>
                    </div>
                    <button
                      onClick={() => setActiveView('dashboard')}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="p-6">
                    <ComplaintForm 
                      onSuccess={() => setActiveView('complaints')} 
                      onCancel={() => setActiveView('dashboard')}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Freshdesk-Style Profile Settings */}
            {
              activeView === 'profile' && (
                <div className="p-3 sm:p-4 md:p-6 bg-gray-50 min-h-screen">
                  <div className="max-w-5xl mx-auto">
                    {/* Profile Header Card */}
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
                      <div className="p-4 sm:p-6">
                        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6">
                          <div className="relative group">
                            {profilePhoto ? (
                              <>
                                <img src={profilePhoto} alt="Profile" className="w-24 h-24 rounded-full object-cover border-4 border-slate-100" />
                                <button
                                  onClick={handlePhotoRemove}
                                  className="absolute top-0 left-0 w-8 h-8 bg-red-500 text-white border-2 border-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100"
                                  title="Remove photo"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            ) : (
                              <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center text-white font-bold text-3xl">
                                {userProfile.name?.charAt(0).toUpperCase() || 'U'}
                              </div>
                            )}
                            <label htmlFor="photo-upload" className="absolute bottom-0 right-0 w-8 h-8 bg-white border-2 border-gray-200 rounded-full flex items-center justify-center hover:bg-gray-50 cursor-pointer transition-colors" title="Upload photo">
                              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            </label>
                            <input
                              id="photo-upload"
                              type="file"
                              accept="image/jpeg,image/png,image/jpg,image/webp"
                              onChange={handlePhotoUpload}
                              className="hidden"
                            />
                          </div>
                          <div className="flex-1">
                            <h2 className="text-2xl font-semibold text-gray-900 mb-2">{userProfile.name}</h2>
                            <p className="text-gray-600 mb-3">{userProfile.email}</p>
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="bg-slate-100 text-slate-800 px-3 py-1 rounded-full text-sm font-medium">{userProfile.role}</span>
                              <span className="text-sm text-gray-600 flex items-center gap-1.5">
                                <Calendar className="w-4 h-4" />
                                Member since {new Date(userProfile.joinDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Settings Sections */}
                    <div className="space-y-6">
                      {/* Personal Information */}
                      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                        <div className="p-5 border-b border-gray-200">
                          <h3 className="text-lg font-semibold text-gray-900">Personal Information</h3>
                          <p className="text-sm text-gray-600 mt-1">Update your personal details and contact information</p>
                        </div>
                        <div className="p-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">First Name</label>
                              <input
                                type="text"
                                value={userProfile.name.split(' ')[0] || ''}
                                onChange={(e) => setUserProfile({ ...userProfile, name: e.target.value + ' ' + (userProfile.name.split(' ')[1] || '') })}
                                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-all"
                                placeholder="Enter first name"
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Last Name</label>
                              <input
                                type="text"
                                value={userProfile.name.split(' ')[1] || ''}
                                onChange={(e) => setUserProfile({ ...userProfile, name: (userProfile.name.split(' ')[0] || '') + ' ' + e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-all"
                                placeholder="Enter last name"
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                              <input
                                type="email"
                                value={userProfile.email}
                                onChange={(e) => setUserProfile({ ...userProfile, email: e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-all"
                                placeholder="your.email@example.com"
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
                              <input
                                type="tel"
                                value={userProfile.phone}
                                onChange={(e) => setUserProfile({ ...userProfile, phone: e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-all"
                                placeholder="+1 (555) 000-0000"
                              />
                            </div>

                            <div className="md:col-span-2">
                              <label className="block text-sm font-medium text-gray-700 mb-2">Organization</label>
                              <input
                                type="text"
                                value={userProfile.organization}
                                onChange={(e) => setUserProfile({ ...userProfile, organization: e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-all"
                                placeholder="Your organization name"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Notification Preferences */}
                      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                        <div className="p-5 border-b border-gray-200">
                          <h3 className="text-lg font-semibold text-gray-900">Notification Preferences</h3>
                          <p className="text-sm text-gray-600 mt-1">Manage how you receive notifications</p>
                        </div>
                        <div className="p-6">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                              <div className="flex items-center gap-3">
                                <Bell className="w-5 h-5 text-gray-600" />
                                <div>
                                  <p className="font-medium text-gray-900">Email Notifications</p>
                                  <p className="text-sm text-gray-600">Receive email updates for ticket status changes</p>
                                </div>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={settings.notifications.email}
                                  onChange={(e) => setSettings({ ...settings, notifications: { ...settings.notifications, email: e.target.checked } })}
                                  className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-slate-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-slate-800"></div>
                              </label>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                              <div className="flex items-center gap-3">
                                <MessageCircle className="w-5 h-5 text-gray-600" />
                                <div>
                                  <p className="font-medium text-gray-900">SMS Notifications</p>
                                  <p className="text-sm text-gray-600">Get text messages for urgent updates</p>
                                </div>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={settings.notifications.sms}
                                  onChange={(e) => setSettings({ ...settings, notifications: { ...settings.notifications, sms: e.target.checked } })}
                                  className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-slate-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-slate-800"></div>
                              </label>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                              <div className="flex items-center gap-3">
                                <Bell className="w-5 h-5 text-gray-600" />
                                <div>
                                  <p className="font-medium text-gray-900">Push Notifications</p>
                                  <p className="text-sm text-gray-600">Receive in-app notifications</p>
                                </div>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={settings.notifications.push}
                                  onChange={(e) => setSettings({ ...settings, notifications: { ...settings.notifications, push: e.target.checked } })}
                                  className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-slate-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-slate-800"></div>
                              </label>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Subscription & Billing */}
                      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                        <div className="p-5 border-b border-gray-200">
                          <h3 className="text-lg font-semibold text-gray-900">Subscription & Billing</h3>
                          <p className="text-sm text-gray-600 mt-1">Manage your subscription plan and billing</p>
                        </div>
                        <div className="p-6">
                          {/* Current Plan Display */}
                          <div className="bg-gradient-to-r from-slate-50 to-blue-50 border border-slate-200 rounded-lg p-6 mb-6">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center">
                                  {user?.planType === 'Premium' ? (
                                    <Crown className="w-6 h-6 text-yellow-400" />
                                  ) : user?.planType === 'Pro' ? (
                                    <Zap className="w-6 h-6 text-blue-400" />
                                  ) : (
                                    <Star className="w-6 h-6 text-gray-400" />
                                  )}
                                </div>
                                <div>
                                  <p className="text-sm text-gray-600">Current Plan</p>
                                  <p className="text-2xl font-bold text-gray-900">{user?.planType || 'Free'}</p>
                                  {user?.planExpiresAt && new Date(user.planExpiresAt) > new Date() && (
                                    <p className="text-sm text-gray-600 mt-1">
                                      Expires on {new Date(user.planExpiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                                    </p>
                                  )}
                                </div>
                              </div>
                              {user?.planType !== 'Free' && (
                                <div className="text-right">
                                  <p className="text-sm text-gray-600">Billing Cycle</p>
                                  <p className="text-lg font-semibold text-gray-900">Monthly</p>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Subscription Error */}
                          {subscriptionError && (
                            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
                              <div className="flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                <p className="text-red-800">{subscriptionError}</p>
                              </div>
                            </div>
                          )}

                          {/* Upgrade Options */}
                          {user?.planType !== 'Premium' && (
                            <div className="space-y-4">
                              <h4 className="font-semibold text-gray-900 mb-4">Upgrade Your Plan</h4>

                              {/* Pro Plan */}
                              {user?.planType !== 'Pro' && (
                                <div className="border-2 border-blue-200 rounded-lg p-5 hover:border-blue-400 transition-all">
                                  <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                                        <Zap className="w-5 h-5 text-blue-600" />
                                      </div>
                                      <div>
                                        <h5 className="font-semibold text-gray-900">Pro Plan</h5>
                                        <p className="text-sm text-gray-600">For growing teams</p>
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-2xl font-bold text-gray-900">₹499</p>
                                      <p className="text-sm text-gray-600">/month</p>
                                    </div>
                                  </div>
                                  <ul className="space-y-2 mb-4">
                                    <li className="flex items-start gap-2 text-sm">
                                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                      <span className="text-gray-700">AI-powered diagnosis</span>
                                    </li>
                                    <li className="flex items-start gap-2 text-sm">
                                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                      <span className="text-gray-700">Unlimited complaints</span>
                                    </li>
                                    <li className="flex items-start gap-2 text-sm">
                                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                      <span className="text-gray-700">Priority support (24h)</span>
                                    </li>
                                    <li className="flex items-start gap-2 text-sm">
                                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                      <span className="text-gray-700">Analytics dashboard</span>
                                    </li>
                                  </ul>
                                  <button
                                    onClick={() => handleUpgradePlan('Pro')}
                                    disabled={upgradingPlan === 'Pro'}
                                    className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                  >
                                    {upgradingPlan === 'Pro' ? (
                                      <>
                                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Processing...
                                      </>
                                    ) : (
                                      'Upgrade to Pro'
                                    )}
                                  </button>
                                </div>
                              )}

                              {/* Premium Plan */}
                              <div className="border-2 border-purple-200 rounded-lg p-5 hover:border-purple-400 transition-all">
                                <div className="flex items-start justify-between mb-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                                      <Crown className="w-5 h-5 text-purple-600" />
                                    </div>
                                    <div>
                                      <h5 className="font-semibold text-gray-900">Premium Plan</h5>
                                      <p className="text-sm text-gray-600">For large enterprises</p>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-2xl font-bold text-gray-900">₹999</p>
                                    <p className="text-sm text-gray-600">/month</p>
                                  </div>
                                </div>
                                <ul className="space-y-2 mb-4">
                                  <li className="flex items-start gap-2 text-sm">
                                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                    <span className="text-gray-700">Everything in Pro, plus:</span>
                                  </li>
                                  <li className="flex items-start gap-2 text-sm">
                                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                    <span className="text-gray-700">Team management (10 users)</span>
                                  </li>
                                  <li className="flex items-start gap-2 text-sm">
                                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                    <span className="text-gray-700">Advanced analytics & reporting</span>
                                  </li>
                                  <li className="flex items-start gap-2 text-sm">
                                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                    <span className="text-gray-700">Custom branding</span>
                                  </li>
                                  <li className="flex items-start gap-2 text-sm">
                                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                    <span className="text-gray-700">Dedicated account manager</span>
                                  </li>
                                </ul>
                                <button
                                  onClick={() => handleUpgradePlan('Premium')}
                                  disabled={upgradingPlan === 'Premium'}
                                  className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-purple-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                  {upgradingPlan === 'Premium' ? (
                                    <>
                                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                      </svg>
                                      Processing...
                                    </>
                                  ) : (
                                    user?.planType === 'Pro' ? 'Upgrade to Premium' : 'Upgrade to Premium'
                                  )}
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Already on Premium */}
                          {user?.planType === 'Premium' && (
                            <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-6 text-center">
                              <Crown className="w-12 h-12 text-purple-600 mx-auto mb-3" />
                              <h5 className="font-semibold text-gray-900 mb-2">You're on our best plan!</h5>
                              <p className="text-gray-600">Enjoy all premium features and priority support.</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Security Settings */}
                      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                        <div className="p-5 border-b border-gray-200">
                          <h3 className="text-lg font-semibold text-gray-900">Security</h3>
                          <p className="text-sm text-gray-600 mt-1">Manage your password and security settings</p>
                        </div>
                        <div className="p-6">
                          <div className="space-y-5">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Current Password</label>
                              <input
                                type="password"
                                value={settings.security.currentPassword}
                                onChange={(e) => setSettings({ ...settings, security: { ...settings.security, currentPassword: e.target.value } })}
                                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-all"
                                placeholder="Enter current password"
                              />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">New Password</label>
                                <input
                                  type="password"
                                  value={settings.security.newPassword}
                                  onChange={(e) => setSettings({ ...settings, security: { ...settings.security, newPassword: e.target.value } })}
                                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-all"
                                  placeholder="Enter new password"
                                />
                              </div>

                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Confirm Password</label>
                                <input
                                  type="password"
                                  value={settings.security.confirmPassword}
                                  onChange={(e) => setSettings({ ...settings, security: { ...settings.security, confirmPassword: e.target.value } })}
                                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-all"
                                  placeholder="Confirm new password"
                                />
                              </div>
                            </div>

                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                              <div className="flex items-start gap-3">
                                <Shield className="w-5 h-5 text-slate-600 mt-0.5" />
                                <div>
                                  <p className="font-medium text-gray-900 mb-1">Two-Factor Authentication</p>
                                  <p className="text-sm text-gray-600 mb-3">Add an extra layer of security to your account</p>
                                  <button className="text-slate-800 hover:text-slate-900 font-medium text-sm">
                                    Enable 2FA →
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Language & Time Zone */}
                      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                        <div className="p-5 border-b border-gray-200">
                          <h3 className="text-lg font-semibold text-gray-900">Language & Region</h3>
                          <p className="text-sm text-gray-600 mt-1">Set your preferred language and timezone</p>
                        </div>
                        <div className="p-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Language</label>
                              <select
                                value={settings.language}
                                onChange={(e) => setSettings({ ...settings, language: e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-all"
                              >
                                <option>English (US)</option>
                                <option>Spanish</option>
                                <option>French</option>
                                <option>German</option>
                                <option>Hindi</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Time Zone</label>
                              <select
                                value={settings.timezone}
                                onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-all"
                              >
                                <option>GMT-8 (Pacific Time)</option>
                                <option>GMT-5 (Eastern Time)</option>
                                <option>GMT+0 (London)</option>
                                <option>GMT+5:30 (India)</option>
                                <option>GMT+8 (Singapore)</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Success/Error Messages */}
                      {(saveSuccess || saveError) && (
                        <div className={`rounded-lg p-4 ${saveSuccess ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                          <div className="flex items-center gap-3">
                            {saveSuccess ? (
                              <>
                                <CheckCircle className="w-5 h-5 text-green-600" />
                                <div>
                                  <p className="font-medium text-green-900">Settings saved successfully!</p>
                                  <p className="text-sm text-green-700 mt-0.5">Your profile and preferences have been updated.</p>
                                </div>
                              </>
                            ) : (
                              <>
                                <AlertCircle className="w-5 h-5 text-red-600" />
                                <div>
                                  <p className="font-medium text-red-900">Error saving settings</p>
                                  <p className="text-sm text-red-700 mt-0.5">{saveError}</p>
                                </div>
                              </>
                            )}
                            <button
                              onClick={() => {
                                setSaveSuccess(false);
                                setSaveError('');
                              }}
                              className="ml-auto text-gray-500 hover:text-gray-700"
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex items-center justify-between bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                        <button
                          onClick={() => setActiveView('dashboard')}
                          className="text-gray-600 hover:text-gray-800 font-medium text-sm"
                        >
                          ← Back to Dashboard
                        </button>
                        <div className="flex gap-3">
                          <button
                            onClick={() => setActiveView('dashboard')}
                            className="bg-gray-200 text-gray-700 px-6 py-2.5 rounded-lg hover:bg-gray-300 font-medium text-sm transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveProfile}
                            disabled={isSaving}
                            className="bg-slate-800 text-white px-6 py-2.5 rounded-lg hover:bg-slate-700 font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSaving ? (
                              <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                Saving...
                              </>
                            ) : (
                              <>
                                <CheckCircle className="w-4 h-4" />
                                Save All Changes
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            }

            {/* Clean Complaint Details Modal */}
            {
              selectedComplaint && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden">
                    <div className="p-5 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <h3 className="text-xl font-semibold text-gray-900">Ticket Details</h3>
                          {/* Complaint ID Badge */}
                          <span className="px-3 py-1 text-sm font-mono font-semibold bg-gray-100 text-gray-700 rounded border border-gray-300">
                            {selectedComplaint.complaintId || selectedComplaint.id}
                          </span>
                        </div>
                        <button
                          onClick={() => setSelectedComplaint(null)}
                          className="text-gray-500 hover:text-gray-700"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    <div className="p-6 overflow-y-auto max-h-[calc(90vh-100px)] custom-scrollbar">
                      <div className="space-y-5">
                        {/* Resolved Banner */}
                        {selectedComplaint.status === 'Resolved' && (
                          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                                <CheckCircle className="w-6 h-6 text-green-600" />
                              </div>
                              <div>
                                <h4 className="font-semibold text-green-800">Complaint Resolved</h4>
                                <p className="text-sm text-green-700">
                                  Your complaint <span className="font-mono font-semibold">{selectedComplaint.complaintId || selectedComplaint.id}</span> has been successfully resolved.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Header */}
                        <div>
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <h4 className="text-lg font-semibold text-gray-900 mb-3">{selectedComplaint.title}</h4>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`px-2.5 py-1 text-xs font-medium rounded border ${getStatusColor(selectedComplaint.status)}`}>
                                  {selectedComplaint.status}
                                </span>
                                <span className={`px-2.5 py-1 text-xs font-medium rounded ${getPriorityColor(selectedComplaint.priority)}`}>
                                  {selectedComplaint.priority} Priority
                                </span>
                                <span className="text-xs text-gray-600 flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5" />
                                  {new Date(selectedComplaint.createdAt).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                            {selectedComplaint.status === 'Resolved' && (
                              <button
                                onClick={() => {
                                  setSelectedComplaint(null);
                                  setShowFeedbackForm(true);
                                }}
                                className="bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-700 flex items-center gap-2 text-sm font-medium"
                              >
                                <Star className="w-4 h-4" />
                                Give Feedback
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Description */}
                        <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg">
                          <h5 className="font-medium text-gray-900 mb-2 text-sm">Description</h5>
                          <p className="text-sm text-gray-700 leading-relaxed">{selectedComplaint.description}</p>
                        </div>

                        {/* Timeline */}
                        <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg">
                          <h5 className="font-medium text-gray-900 mb-4 text-sm">Activity Timeline</h5>
                          <div className="space-y-4 relative">
                            <div className="absolute left-4 top-4 bottom-4 w-px bg-gray-300"></div>

                            <div className="flex gap-3 relative">
                              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center z-10">
                                <Clock className="w-4 h-4 text-blue-600" />
                              </div>
                              <div className="flex-1 pt-0.5">
                                <p className="font-medium text-gray-900 text-sm">Ticket Submitted</p>
                                <p className="text-xs text-gray-600 mt-0.5">ID: #{selectedComplaint.id}</p>
                                <p className="text-xs text-gray-500 mt-1">{new Date(selectedComplaint.createdAt).toLocaleString()}</p>
                              </div>
                            </div>

                            {selectedComplaint.status !== 'Open' && (
                              <div className="flex gap-3 relative">
                                <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center z-10">
                                  <Eye className="w-4 h-4 text-yellow-600" />
                                </div>
                                <div className="flex-1 pt-0.5">
                                  <p className="font-medium text-gray-900 text-sm">Under Review</p>
                                  <p className="text-xs text-gray-600 mt-0.5">Assigned to support team</p>
                                  <p className="text-xs text-gray-500 mt-1">Updated recently</p>
                                </div>
                              </div>
                            )}

                            {selectedComplaint.status === 'Resolved' && (
                              <div className="flex gap-3 relative">
                                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center z-10">
                                  <CheckCircle className="w-4 h-4 text-green-600" />
                                </div>
                                <div className="flex-1 pt-0.5">
                                  <p className="font-medium text-gray-900 text-sm">Ticket Resolved</p>
                                  <p className="text-xs text-gray-600 mt-0.5">Successfully closed</p>
                                  <p className="text-xs text-gray-500 mt-1">Recently</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Support */}
                        <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-gray-900 text-sm">Need Additional Help?</p>
                              <p className="text-xs text-gray-600 mt-0.5">Chat with our support assistant</p>
                            </div>
                            <button
                              onClick={() => {
                                setSelectedComplaint(null);
                                setShowChatBot(true);
                              }}
                              className="bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-700 text-sm font-medium"
                            >
                              Chat Now
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            }

            {/* ChatBot Modal */}
            {
              showChatBot && (
                <AIAssistant onClose={() => setShowChatBot(false)} />
              )
            }

            {/* Notifications Modal */}
            <NotificationCenter
              isOpen={showNotifications}
              onClose={() => setShowNotifications(false)}
            />

            {/* Clean Feedback Form Modal */}
            {
              showFeedbackForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
                    <div className="p-5 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-gray-900">Submit Feedback</h3>
                        <button
                          onClick={() => setShowFeedbackForm(false)}
                          className="text-gray-500 hover:text-gray-700"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    <div className="p-5">
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Rating</label>
                          <div className="flex gap-2">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                className="text-3xl hover:scale-110 transition-transform"
                              >
                                ⭐
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Comments</label>
                          <textarea
                            className="w-full border border-gray-300 rounded-lg p-3 h-24 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                            placeholder="Share your feedback..."
                          />
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={() => setShowFeedbackForm(false)}
                            className="flex-1 bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-700 font-medium text-sm"
                          >
                            Submit
                          </button>
                          <button
                            onClick={() => setShowFeedbackForm(false)}
                            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            }

            {/* Search Modal */}
            {
              showSearchModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-20">
                  <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[70vh] flex flex-col">
                    <div className="p-4 border-b border-gray-200">
                      <div className="flex items-center gap-3">
                        <Search className="w-5 h-5 text-gray-400" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search complaints by ID, title, or description..."
                          className="flex-1 outline-none text-lg"
                          autoFocus
                        />
                        <button
                          onClick={() => {
                            setShowSearchModal(false);
                            setSearchQuery('');
                          }}
                          className="p-1 hover:bg-gray-100 rounded"
                        >
                          <X className="w-5 h-5 text-gray-500" />
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      {searchQuery.trim() ? (
                        filteredBySearch.length > 0 ? (
                          <div className="divide-y divide-gray-100">
                            {filteredBySearch.map((complaint) => (
                              <button
                                key={complaint.id}
                                onClick={() => handleSearchSelect(complaint)}
                                className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm font-medium text-blue-600">
                                    #{complaint.complaintId || complaint.id.slice(-8)}
                                  </span>
                                  <span className={`px-2 py-0.5 text-xs rounded-full ${complaint.status === 'Resolved' ? 'bg-green-100 text-green-700' :
                                    complaint.status === 'In Progress' ? 'bg-blue-100 text-blue-700' :
                                      complaint.status === 'Open' ? 'bg-yellow-100 text-yellow-700' :
                                        complaint.status === 'Escalated' ? 'bg-red-100 text-red-700' :
                                          'bg-gray-100 text-gray-700'
                                    }`}>
                                    {complaint.status}
                                  </span>
                                </div>
                                <p className="font-medium text-gray-900 truncate">{complaint.title}</p>
                                <p className="text-sm text-gray-500 truncate">{complaint.description}</p>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="p-8 text-center text-gray-500">
                            <Search className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                            <p>No complaints found matching "{searchQuery}"</p>
                          </div>
                        )
                      ) : (
                        <div className="p-8 text-center text-gray-500">
                          <Search className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                          <p>Start typing to search complaints...</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
          </>
        )}
      </div>
    </div>
  );
}