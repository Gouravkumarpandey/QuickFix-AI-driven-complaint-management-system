// ApiService.ts - API Service for frontend-backend communication
import api, { getErrorMessage } from '../utils/api';
import type { Agent } from './agentService';

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
  networkError?: boolean;
}

class ApiService {
  // Using shared Axios instance from utils/api.ts
  // All requests automatically include credentials and auth headers

  private async request<T>(
    endpoint: string,
    options: {
      method?: string;
      body?: unknown;
      params?: Record<string, unknown>;
    } = {}
  ): Promise<ApiResponse<T>> {
    try {
      const config = {
        method: options.method || 'GET',
        url: endpoint,
        data: options.body,
        params: options.params,
      };

      const response = await api.request(config);
      return { data: response.data as T };
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      const isNetworkErr = error && typeof error === 'object' && !('response' in error);
      return { error: errorMessage, networkError: Boolean(isNetworkErr) };
    }
  }

  // --------------------- Auth ---------------------
  async login(email: string, password: string) {
    return this.request('/auth/login', { method: 'POST', body: { email, password } });
  }

  async register(userData: { firstName: string; lastName: string; email: string; password: string; role?: string; department?: string }) {
    return this.request('/auth/register', { method: 'POST', body: userData });
  }
  
  async forgotPassword(email: string): Promise<ApiResponse<{ success: boolean; message: string }>> {
    try {
      const result = await this.request<{ success: boolean; message: string }>('/auth/forgot-password', { 
        method: 'POST', 
        body: { email }
      });
      return result;
    } catch {
      return { error: "Failed to send password reset request. Please try again later." };
    }
  }
  
  async resetPassword(token: string, password: string) {
    try {
      const result = await this.request('/auth/reset-password', { 
        method: 'POST', 
        body: { token, password }
      });
      if (result.error) {
        return { 
          error: result.error || "Failed to reset password. Please try again or request a new reset link." 
        };
      }
      return result;
    } catch {
      return { 
        error: "Failed to reset password. Please try again or request a new reset link.",
        networkError: true
      };
    }
  }
  
  async verifyResetToken(token: string) {
    try {
      const result = await this.request(`/auth/verify-reset-token/${token}`);
      if (result.error) {
        return { 
          error: result.error || "Failed to verify reset token. It might be invalid or expired." 
        };
      }
      return result;
    } catch {
      return { 
        error: "Failed to verify reset token. It might be invalid or expired.",
        networkError: true
      };
    }
  }

  async refreshToken(token: string) {
    return this.request('/auth/refresh', { method: 'POST', body: { refreshToken: token } });
  }

  // --------------------- Complaints ---------------------
  async getComplaints(filters?: Record<string, string | number | boolean>) {
    return this.request('/complaints', { params: filters });
  }

  async getComplaint(id: string) { 
    return this.request(`/complaints/${id}`); 
  }
  
  async createComplaint(data: { title: string; description: string; category?: string; attachments?: string[] }) {
    return this.request('/complaints', { method: 'POST', body: data });
  }
  
  async updateComplaintStatus(id: string, status: string, message?: string) {
    return this.request(`/complaints/${id}/status`, { method: 'PATCH', body: { status, message } });
  }
  
  async assignComplaint(id: string, agentId: string) {
    return this.request(`/complaints/${id}/assign`, { method: 'PATCH', body: { agentId } });
  }
  
  async addComplaintUpdate(id: string, data: { message: string; type?: string; isInternal?: boolean; attachments?: string[] }) {
    return this.request(`/complaints/${id}/updates`, { method: 'POST', body: data });
  }
  
  async escalateComplaint(id: string, reason: string) { 
    return this.request(`/complaints/${id}/escalate`, { method: 'PATCH', body: { reason } }); 
  }
  
  async submitFeedback(id: string, rating: number, comment: string) { 
    return this.request(`/complaints/${id}/feedback`, { method: 'POST', body: { rating, comment } }); 
  }

  // --------------------- Users ---------------------
  async getUserProfile() { 
    return this.request('/users/profile'); 
  }
  
  async updateUserProfile(profileData: Record<string, unknown>) {
    return this.request('/users/profile', { method: 'PATCH', body: profileData });
  }
  
  async changePassword(currentPassword: string, newPassword: string) {
    return this.request('/users/password', { method: 'PATCH', body: { currentPassword, newPassword } });
  }

  // --------------------- Analytics ---------------------
  async getDashboardAnalytics(timeRange: string = '30') { 
    return this.request('/analytics/dashboard', { params: { timeRange } }); 
  }
  
  async getDashboardComplete(timeRange: string = '30') { 
    return this.request('/analytics/dashboard-complete', { params: { timeRange } }); 
  }
  
  async getTeamPerformance(timeRange: string = '30') { 
    return this.request('/analytics/team-performance', { params: { timeRange } }); 
  }
  
  async getCategoryTrends(timeRange: string = '90') { 
    return this.request('/analytics/trends/category', { params: { timeRange } }); 
  }
  
  async getSLACompliance(timeRange: string = '30') { 
    return this.request('/analytics/sla-compliance', { params: { timeRange } }); 
  }
  
  async getAnalyticsOverview() { 
    return this.request('/analytics/overview'); 
  }
  
  async getAnalyticsStatus() { 
    return this.request('/analytics/status'); 
  }
  
  async getAnalyticsCategory() { 
    return this.request('/analytics/category'); 
  }
  
  async getAgentPerformance() { 
    return this.request('/analytics/agent-performance'); 
  }

  // --------------------- Admin ---------------------
  async getSystemStats() { 
    return this.request('/admin/stats'); 
  }
  
  async getAllUsers(filters?: Record<string, string | number | boolean>) {
    return this.request('/admin/users', { params: filters });
  }
  
  async updateUser(id: string, userData: Record<string, unknown>) { 
    return this.request(`/users/${id}`, { method: 'PATCH', body: userData }); 
  }
  
  async bulkAssignComplaints(ids: string[], agentId: string) { 
    return this.request('/admin/complaints/bulk-assign', { method: 'PATCH', body: { complaintIds: ids, agentId } }); 
  }

  // --------------------- Notifications ---------------------
  async getNotifications() { 
    return this.request('/notifications'); 
  }
  
  async markNotificationAsRead(id: string) { 
    return this.request(`/notifications/${id}/read`, { method: 'PATCH' }); 
  }
  
  async markAllNotificationsAsRead() { 
    return this.request('/notifications/read-all', { method: 'POST' }); 
  }
  
  async deleteNotification(id: string) { 
    return this.request(`/notifications/${id}`, { method: 'DELETE' }); 
  }
  
  async clearReadNotifications() { 
    return this.request('/notifications/clear/read', { method: 'DELETE' }); 
  }
  
  async getNotificationPreferences() { 
    return this.request('/notifications/preferences'); 
  }
  
  async updateNotificationPreferences(preferences: Record<string, unknown>) { 
    return this.request('/notifications/preferences', { method: 'PATCH', body: preferences }); 
  }

  // --------------------- Agents ---------------------
  async getAllAgents() { 
    return this.request<Agent[]>('/agents'); 
  }
  
  async getAvailableAgents() { 
    return this.request<Agent[]>('/agents/available'); 
  }
  
  async updateAgentAvailability(agentId: string, status: 'available' | 'busy' | 'offline') { 
    return this.request<Agent>(`/agents/${agentId}/availability`, { method: 'PATCH', body: { status } });
  }
  
  async refreshAgentAvailability(agentId: string) { 
    return this.request<Agent>(`/agents/${agentId}/refresh-availability`, { method: 'POST' });
  }
}

export const apiService = new ApiService();
export default apiService;
