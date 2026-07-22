import { LocalOnlyApp } from '@/components/LocalOnlyApp';

export const metadata = {
  title: 'Sugi Local Logger',
  description: '端末内だけに保存するオフライン販売記録アプリ',
};

export default function LocalPage() {
  return <LocalOnlyApp />;
}
