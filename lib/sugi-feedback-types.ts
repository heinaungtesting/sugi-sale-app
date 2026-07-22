export const FEEDBACK_CATEGORIES = ['改善案', '不具合', 'その他'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_STATUSES = ['未確認', '確認済み', '対応中', '完了'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type UserFeedback = {
  id: number;
  category: FeedbackCategory;
  message: string;
  status: FeedbackStatus;
  created_at: string;
};

export type AdminFeedback = UserFeedback & {
  user_id: number;
  username: string;
  display_name: string;
};
