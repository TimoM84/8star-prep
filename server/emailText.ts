export type Lang = 'nl' | 'en';

const T = {
  nl: {
    subjectDue: (n: number) => `Noodvoorraad: ${n} ${n === 1 ? 'product verloopt binnenkort' : 'producten verlopen binnenkort'}`,
    subjectExpired: (n: number) => `Noodvoorraad: ${n} ${n === 1 ? 'product is verlopen' : 'producten zijn verlopen'}`,
    subjectBoth: (n: number) => `Noodvoorraad: ${n} producten verlopen of zijn verlopen`,
    intro: 'Dit is het overzicht van je noodvoorraad voor producten waarvan de datum nadert of is verstreken.',
    dueTitle: 'Binnenkort verlopen',
    expiredTitle: 'Verlopen',
    colProduct: 'Product', colAmount: 'Hoeveelheid', colDate: 'Datum', colType: 'Type', colWhen: 'Wanneer',
    tht: 'THT (ten minste houdbaar tot)', tgt: 'TGT (te gebruiken tot)',
    inDays: (d: number) => (d === 0 ? 'vandaag' : d === 1 ? 'morgen' : `over ${d} dagen`),
    agoDays: (d: number) => (d === 1 ? '1 dag geleden' : `${d} dagen geleden`),
    footer: 'Controleer de producten zelf. Deze melding zegt niet of iets veilig of onveilig is om te eten.',
    testSubject: 'Noodvoorraad: testbericht',
    testBody: 'Dit is een testbericht. Als je dit leest, werken de e-mailinstellingen.',
  },
  en: {
    subjectDue: (n: number) => `Emergency pantry: ${n} ${n === 1 ? 'item expires soon' : 'items expire soon'}`,
    subjectExpired: (n: number) => `Emergency pantry: ${n} ${n === 1 ? 'item has expired' : 'items have expired'}`,
    subjectBoth: (n: number) => `Emergency pantry: ${n} items expiring or expired`,
    intro: 'This is the overview of your emergency pantry for products whose date is approaching or has passed.',
    dueTitle: 'Expiring soon',
    expiredTitle: 'Expired',
    colProduct: 'Product', colAmount: 'Amount', colDate: 'Date', colType: 'Type', colWhen: 'When',
    tht: 'Best before (THT)', tgt: 'Use by (TGT)',
    inDays: (d: number) => (d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`),
    agoDays: (d: number) => (d === 1 ? '1 day ago' : `${d} days ago`),
    footer: 'Please check the products yourself. This message does not say whether anything is safe or unsafe to eat.',
    testSubject: 'Emergency pantry: test message',
    testBody: 'This is a test message. If you can read this, your email settings work.',
  },
} as const;

export const emailText = (l: Lang) => T[l];
