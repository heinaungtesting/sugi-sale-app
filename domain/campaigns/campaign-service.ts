import {
  applyDueMonthlyPointCampaigns,
  stageNextMonthPointCampaignFromJson,
} from '@/lib/sugi-admin-db';

export const campaignService = {
  stageNextMonth: stageNextMonthPointCampaignFromJson,
  applyDue: applyDueMonthlyPointCampaigns,
};
