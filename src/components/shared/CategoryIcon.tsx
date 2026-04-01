import {
  Car,
  Landmark,
  GraduationCap,
  Wrench,
  Croissant,
  Home,
  Apple,
  ShoppingBag,
  UtensilsCrossed,
  HeartPulse,
  CircleEllipsis,
  ShoppingCart,
  Gift,
  Truck,
  House,
  CreditCard,
  Gamepad2,
  Coffee,
  Sparkles,
  Plane,
  Users,
  Briefcase,
  Wifi,
  Smartphone,
  Dumbbell,
  Music,
  Dog,
  Baby,
  Zap,
  Tv,
  Shirt,
  Wallet,
  Banknote,
  Receipt,
  Scissors,
  HandPlatter,
  Pizza,
  Beer,
  Salad,
  Fuel,
  ParkingCircle,
  Bus,
  TrainFront,
  Bike,
  BookOpen,
  Pencil,
  Palette,
  Camera,
  Gem,
  Watch,
  Glasses,
  Pill,
  Stethoscope,
  Flower2,
  TreePine,
  Umbrella,
  Sun,
  Moon,
  Star,
  Tag,
  type LucideIcon,
} from 'lucide-react';

// Map icon key → Lucide component
export const ICON_MAP: Record<string, LucideIcon> = {
  car: Car,
  landmark: Landmark,
  'graduation-cap': GraduationCap,
  wrench: Wrench,
  croissant: Croissant,
  home: Home,
  apple: Apple,
  'shopping-bag': ShoppingBag,
  'utensils-crossed': UtensilsCrossed,
  'heart-pulse': HeartPulse,
  'circle-ellipsis': CircleEllipsis,
  'shopping-cart': ShoppingCart,
  gift: Gift,
  truck: Truck,
  house: House,
  'credit-card': CreditCard,
  gamepad: Gamepad2,
  coffee: Coffee,
  sparkles: Sparkles,
  plane: Plane,
  users: Users,
  briefcase: Briefcase,
  wifi: Wifi,
  smartphone: Smartphone,
  dumbbell: Dumbbell,
  music: Music,
  dog: Dog,
  baby: Baby,
  zap: Zap,
  tv: Tv,
  shirt: Shirt,
  wallet: Wallet,
  banknote: Banknote,
  receipt: Receipt,
  scissors: Scissors,
  'hand-platter': HandPlatter,
  pizza: Pizza,
  beer: Beer,
  salad: Salad,
  fuel: Fuel,
  'parking-circle': ParkingCircle,
  bus: Bus,
  train: TrainFront,
  bike: Bike,
  'book-open': BookOpen,
  pencil: Pencil,
  palette: Palette,
  camera: Camera,
  gem: Gem,
  watch: Watch,
  glasses: Glasses,
  pill: Pill,
  stethoscope: Stethoscope,
  flower: Flower2,
  'tree-pine': TreePine,
  umbrella: Umbrella,
  sun: Sun,
  moon: Moon,
  star: Star,
  tag: Tag,
};

// All available icon keys for the picker
export const ICON_KEYS = Object.keys(ICON_MAP);

// Render a Lucide icon by its key string. Falls back to Tag for unknown keys/emojis.
export function CategoryIcon({ icon, size = 16, className = '' }: { icon: string; size?: number; className?: string }) {
  const IconComponent = ICON_MAP[icon];
  if (IconComponent) {
    return <IconComponent size={size} className={className} />;
  }
  // Fallback: if it's an old emoji, show Tag icon
  return <Tag size={size} className={className} />;
}

// Auto-suggest an icon key based on category name (Portuguese)
export function suggestIconForCategory(name: string): string {
  const n = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const rules: [string[], string][] = [
    // Transport
    [['transporte', 'uber', 'taxi', '99', 'cabify', 'pedagio'], 'car'],
    [['combustivel', 'gasolina', 'etanol', 'posto'], 'fuel'],
    [['estacionamento', 'parking'], 'parking-circle'],
    [['onibus', 'metro', 'trem', 'bilhete unico'], 'bus'],
    [['bicicleta', 'bike'], 'bike'],
    // Food
    [['alimentacao', 'alimento'], 'apple'],
    [['restaurante', 'networking'], 'utensils-crossed'],
    [['padaria', 'confeitaria', 'bolo'], 'croissant'],
    [['mercado', 'hortifruti', 'feira', 'supermercado', 'hortifruit'], 'shopping-cart'],
    [['delivery', 'ifood', 'rappi'], 'truck'],
    [['lanchinho', 'cafe', 'lanche', 'snack'], 'coffee'],
    [['pizza', 'pizzaria'], 'pizza'],
    [['bar', 'cerveja', 'happy hour', 'boteco'], 'beer'],
    // Home
    [['aluguel', 'condominio'], 'home'],
    [['moradia', 'casa', 'apartamento'], 'house'],
    [['melhoria', 'imovel', 'reforma', 'manutencao'], 'wrench'],
    // Finance
    [['plataforma financeira', 'banco', 'investimento', 'corretora'], 'landmark'],
    [['desp. financeira', 'despesa financeira', 'tarifa', 'taxa', 'iof', 'juros', 'anuidade'], 'credit-card'],
    // Health
    [['saude', 'medico', 'hospital', 'clinica', 'exame', 'consulta'], 'heart-pulse'],
    [['farmacia', 'remedio', 'medicamento'], 'pill'],
    // Education
    [['educacao', 'curso', 'escola', 'faculdade', 'livro', 'material escolar'], 'graduation-cap'],
    // Shopping
    [['compra', 'shopping', 'loja'], 'shopping-bag'],
    [['roupa', 'vestuario', 'calcado', 'sapato'], 'shirt'],
    // Personal care
    [['cuidado pessoal', 'cuidados pessoais', 'higiene', 'beleza', 'cosmetico', 'cabelo', 'estetica'], 'sparkles'],
    // Leisure
    [['lazer', 'diversao', 'entretenimento', 'cinema', 'teatro'], 'gamepad'],
    [['viagem', 'viagens', 'passagem', 'hotel', 'hospedagem'], 'plane'],
    [['comemoracao', 'comemoracoes', 'festa', 'aniversario', 'presente'], 'gift'],
    // Tech
    [['assinatura', 'streaming', 'netflix', 'spotify', 'disney'], 'tv'],
    [['internet', 'telefone', 'celular', 'plano'], 'smartphone'],
    // Work
    [['trabalho', 'escritorio', 'material'], 'briefcase'],
    // Pets
    [['pet', 'animal', 'veterinario', 'racao', 'cachorro', 'gato'], 'dog'],
    // Kids
    [['filho', 'bebe', 'crianca', 'fralda', 'infantil'], 'baby'],
    // Other
    [['outras despesa', 'outros', 'diversos'], 'circle-ellipsis'],
  ];

  for (const [keywords, iconKey] of rules) {
    if (keywords.some((kw) => n.includes(kw))) return iconKey;
  }
  return 'tag';
}
