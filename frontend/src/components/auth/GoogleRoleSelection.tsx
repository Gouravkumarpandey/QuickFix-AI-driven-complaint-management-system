import React, { useState } from 'react';
import { User, Shield, UserCheck, BarChart3, ArrowRight, Building2, ArrowLeft, Phone, CheckCircle2 } from 'lucide-react';

interface GoogleRoleSelectionProps {
  onRoleSelected: (role: 'user' | 'agent' | 'analytics' | 'admin', organization?: string, phoneNumber?: string) => void;
  onCancel: () => void;
  userInfo: {
    name: string;
    email: string;
  };
}

export function GoogleRoleSelection({ onRoleSelected, onCancel, userInfo }: GoogleRoleSelectionProps) {
  const [selectedRole, setSelectedRole] = useState<'user' | 'agent' | 'analytics' | 'admin'>('user');
  const [organization, setOrganization] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('+91 ');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const roles = [
    {
      id: 'user' as const,
      title: 'Customer / User',
      description: 'Submit and track your complaints',
      icon: User,
      color: 'blue',
      requiresOrg: false,
    },
    {
      id: 'agent' as const,
      title: 'Support Agent',
      description: 'Handle and resolve customer complaints',
      icon: UserCheck,
      color: 'emerald',
      requiresOrg: true,
    },
    {
      id: 'analytics' as const,
      title: 'Analytics Manager',
      description: 'View reports and analyze data',
      icon: BarChart3,
      color: 'amber',
      requiresOrg: true,
    },
  ];

  const selectedRoleData = roles.find(r => r.id === selectedRole);
  const requiresOrganization = selectedRoleData?.requiresOrg || false;

  const validateIndianPhone = (phone: string) => {
    // Remove spaces, dashes, plus sign
    const cleanPhone = phone.replace(/[\s\-\+]/g, '');
    // Check if it matches Indian format (starts with 91 followed by 10 digits, or just 10 digits starting with 6-9)
    if (cleanPhone.length < 10) return false;
    const last10 = cleanPhone.slice(-10);
    return /^[6-9]\d{9}$/.test(last10);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate organization field if required
    if (requiresOrganization && !organization.trim()) {
      setError('Organization name is required for this role');
      return;
    }

    // Validate phone number (required for all roles)
    if (!phoneNumber.trim()) {
      setError('Phone number is required for notifications');
      return;
    }

    if (!validateIndianPhone(phoneNumber)) {
      setError('Please enter a valid Indian phone number (+91)');
      return;
    }

    setLoading(true);
    try {
      await onRoleSelected(
        selectedRole,
        requiresOrganization ? organization.trim() : undefined,
        phoneNumber.trim()
      );
    } finally {
      setLoading(false);
    }
  };

  const getStyleClasses = (color: string, isSelected: boolean) => {
    const base = "relative p-4 rounded-xl border-2 transition-all duration-300 text-left group overflow-hidden";

    if (!isSelected) {
      return `${base} border-gray-100 bg-white hover:border-blue-100 hover:shadow-md`;
    }

    const styles = {
      blue: 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500 shadow-lg shadow-blue-500/10',
      emerald: 'border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500 shadow-lg shadow-emerald-500/10',
      violet: 'border-violet-500 bg-violet-50/50 ring-1 ring-violet-500 shadow-lg shadow-violet-500/10',
      amber: 'border-amber-500 bg-amber-50/50 ring-1 ring-amber-500 shadow-lg shadow-amber-500/10',
    };
    return `${base} ${styles[color as keyof typeof styles] || styles.blue}`;
  };

  const getIconColor = (color: string) => {
    const colors = {
      blue: 'text-blue-600',
      emerald: 'text-emerald-600',
      violet: 'text-violet-600',
      amber: 'text-amber-600',
    };
    return colors[color as keyof typeof colors] || colors.blue;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex font-sans">
      {/* Left Side - Image and branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#0F172A] relative overflow-hidden flex-col justify-between p-12">
        {/* Background Gradients */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[120px]"></div>
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col h-full">
          <button
            type="button"
            onClick={onCancel}
            className="text-white/70 hover:text-white transition-colors duration-200 flex items-center gap-2 font-medium text-sm w-fit"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Sign Up
          </button>

          <div className="mt-auto mb-20">
            <h1 className="text-5xl font-bold text-white mb-6 leading-tight">
              Complete Your <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">Profile Setup</span>
            </h1>
            <p className="text-xl text-gray-400 max-w-md leading-relaxed">
              Create your customer account. Staff accounts are provided by your administrator.
            </p>
          </div>

          {/* Steps/Indicators */}
          <div className="flex gap-2">
            <div className="h-1 w-8 bg-blue-500 rounded-full"></div>
            <div className="h-1 w-8 bg-gray-700 rounded-full"></div>
          </div>
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-6 lg:p-12 overflow-y-auto bg-white/50 backdrop-blur-3xl">
        <div className="max-w-[480px] w-full">
          {/* Header for Mobile */}
          <div className="lg:hidden mb-8">
            <button
              onClick={onCancel}
              className="text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-2 text-sm font-medium mb-6"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Almost there!</h1>
            <p className="text-gray-500">Let's finish setting up your account.</p>
          </div>

          <div className="flex items-center gap-4 mb-8 p-4 bg-blue-50 rounded-2xl border border-blue-100">
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-xl font-bold text-blue-600">
              {userInfo.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-gray-900">{userInfo.name}</p>
              <p className="text-sm text-gray-500">{userInfo.email}</p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-blue-500 ml-auto" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Role Selection */}
            <div className="space-y-4">
              <label className="block text-sm font-semibold text-gray-900">
                Select Account Type
              </label>
              <div className="grid grid-cols-1 gap-3">
                {roles.filter(role => role.id === 'user').map((role) => {
                  const Icon = role.icon;
                  const isSelected = selectedRole === role.id;

                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setSelectedRole(role.id)}
                      className={getStyleClasses(role.color, isSelected)}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`p-2.5 rounded-xl transition-colors duration-300 ${isSelected ? 'bg-white shadow-sm' : 'bg-gray-50 group-hover:bg-blue-50'}`}>
                          <Icon className={`w-5 h-5 ${getIconColor(role.color)}`} />
                        </div>
                        <div className="flex-1">
                          <h3 className={`font-semibold text-sm transition-colors ${isSelected ? 'text-gray-900' : 'text-gray-700'}`}>
                            {role.title}
                          </h3>
                          <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                            {role.description}
                          </p>
                        </div>
                        {isSelected && (
                          <div className={`w-4 h-4 rounded-full border-[3px] mt-1 ${role.color === 'blue' ? 'border-blue-500' :
                            role.color === 'emerald' ? 'border-emerald-500' :
                              role.color === 'violet' ? 'border-violet-500' : 'border-amber-500'
                            }`}></div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4 animate-fadeIn">
              {/* Organization Field */}
              {requiresOrganization && (
                <div className="group">
                  <label htmlFor="organization" className="block text-sm font-semibold text-gray-900 mb-2">
                    Organization
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Building2 className="h-5 w-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    </div>
                    <input
                      id="organization"
                      type="text"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl leading-5 bg-gray-50 placeholder-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 sm:text-sm"
                      placeholder="Company or Organization Name"
                      required={requiresOrganization}
                    />
                  </div>
                </div>
              )}

              {/* Phone Number Field */}
              <div className="group">
                <label htmlFor="phoneNumber" className="block text-sm font-semibold text-gray-900 mb-2">
                  Phone Number <span className="text-gray-400 font-normal">(WhatsApp Enabled)</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Phone className="h-5 w-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                  </div>
                  <input
                    id="phoneNumber"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl leading-5 bg-gray-50 placeholder-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 sm:text-sm"
                    placeholder="+91 98765 43210"
                    required
                  />
                </div>
                <p className="mt-1.5 text-xs text-gray-500">We require a valid Indian phone number (+91) for account verification.</p>
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-50/50 border border-red-100 rounded-xl text-sm text-red-600 flex items-center gap-2 animate-fadeIn">
                <Shield className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center items-center py-3.5 px-4 border border-transparent rounded-xl shadow-lg shadow-blue-500/30 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:shadow-none transition-all duration-200 hover:-translate-y-0.5"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Complete Registration
                  <ArrowRight className="ml-2 -mr-1 h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
