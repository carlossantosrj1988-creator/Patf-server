// ══════════════════════════════════════════════════
// PATF TCG — Engine de Batalha (Servidor)
// Parte 1: Dados dos Personagens
// ══════════════════════════════════════════════════
// Este arquivo contém todos os dados de personagens
// que o servidor precisa para processar a batalha.
// ══════════════════════════════════════════════════

const SUIT_ADV = {
  hearts:   'hearts>clubs',
  clubs:    'clubs>diamonds',
  diamonds: 'diamonds>spades',
  spades:   'spades>hearts',
  neutral:  'none'
};

const CHARS = [
  {id:'kuro',name:'Kuro Isamu',suit:'neutral',atq:3,def:5,inc:1,pvs:100,skills:[
    {id:'sho',name:'Seiken Tsuki',power:3,type:'Corporal',target:'enemy',acao:'N',recarga:'N',turno:'N',
      desc:'Aplica Marcado (2t) no alvo. Se alvo ja Marcado: poder x2 e renova a Marca.'},
    {id:'tat',name:'Sanren Geri',power:'1/1/1',type:'Corporal',target:'enemy',acao:'N',recarga:'N',turno:'N',
      desc:'3 golpes. Se alvo Marcado: poder de cada golpe x3 e consome a Marca.'},
    {id:'had',name:'Kohouken',power:5,type:'Energia',target:'enemy',acao:'N',recarga:'N',turno:'N',
      desc:'Poder base 5 + 2 por carga de Concentracao Marcial. Consome todas as cargas ao disparar.'},
  ]},
  {id:'vanc',name:'Comandante Vance',suit:'spades',atq:5,def:3,inc:1,pvs:110,skills:[
    {id:'soc',name:'Golpe Tatico',power:5,type:'Corporal',target:'enemy',recharge:false,desc:''},
    {id:'foc',name:'Punho Incendiario',power:3,type:'Fogo',target:'enemy',recharge:true,desc:'Aplica Queimadura.'},
    {id:'ele',name:'Descarga Eletrica',power:5,type:'Eletrico',target:'all_enemy',recharge:true,desc:'Catastrofico + Ignora Armadura.'},
  ]},
  {id:'zeph',name:'Zephyr',suit:'clubs',atq:4,def:3,inc:3,pvs:110,skills:[
    {id:'fac',name:'Facada Sonica',power:3,type:'Distancia',target:'all_enemy',recharge:false,desc:'Atinge todos os inimigos.'},
    {id:'seu',name:'Sou Seu Amigo',power:0,type:'Encanto',target:'enemy',recharge:true,desc:'Encantado: 50% de entrar na frente do proprio aliado. Acao Rapida.'},
    {id:'pre',name:'Prestidigitacao',power:0,type:'Melhoria',target:'all_ally',recharge:true,desc:'Imagem Espelhada em todos aliados: 50% esquiva 1 turno.'},
  ]},
  {id:'kane',name:'Kane',suit:'clubs',atq:4,def:4,inc:2,pvs:110,skills:[
    {id:'esf',name:'Facada',power:1,type:'Cortante',target:'enemy',recharge:false,acao:'N',recarga:'N',turno:'N',
     desc:'Ignora Armadura.'},
    {id:'wpn',name:'Disparo Pistola',power:4,type:'Distancia',target:'enemy',recharge:false,acao:'N',recarga:'N',turno:'N',
     desc:'Critico Alto: 50% de chance de dano dobrado.'},
    {id:'gran',name:'Lanca Granada',power:2,type:'Fogo',target:'all_enemy',recharge:true,acao:'N',recarga:'L',turno:'N',
     desc:'Explosao em area. Atinge todos os inimigos. Aplica Queimadura.'},
  ]},
  {id:'gora',name:'Gorath',suit:'hearts',atq:4,def:5,inc:0,pvs:130,skills:[
    {id:'atc',name:'ATACARRRR',power:4,type:'Cortante',target:'enemy',recharge:false,desc:'Amaciado: dobra poder Cortante por 2 turnos.'},
    {id:'tas',name:'SKAAAAARRRRR',power:4,type:'Invocacao',target:'enemy',recharge:false,desc:'Acao Rapida.'},
    {id:'ago',name:'Agora e Serio',power:0,type:'Melhoria',target:'self',recharge:true,desc:'Cada ataque recebido aumenta ATACARRRR em 4 ate proximo turno.'},
  ]},
  {id:'grim',name:'Grimbol',suit:'diamonds',atq:2,def:3,inc:1,pvs:110,skills:[
    {id:'arc',name:'Arcabuz',power:5,type:'Distancia',target:'enemy',turno:'L',recarga:'L',acao:'N',desc:''},
    {id:'bac',name:'Bomba Acida',power:1,type:'Quimico',target:'all_enemy',recharge:true,desc:'Derreter Armadura: ignora DEF base por 1 turno.'},
    {id:'eli',name:'Elixir da Cura',power:3,type:'Cura',target:'all_ally',recharge:true,desc:'Cura todos os aliados.'},
  ]},
  {id:'sam',name:'Sam',suit:'diamonds',atq:3,def:5,inc:2,pvs:100,skills:[
    {id:'fpl',name:'Feixe de Plasma',power:1,type:'Energia',target:'enemy',recharge:true,desc:'Ignora Armadura. Poder = cargas (max 5). Com 5: atinge TODOS.'},
    {id:'ffr',name:'Feixe Congelante',power:1,type:'Frio',target:'enemy',recharge:true,desc:'Congela: 50% de chance de perder rodada. Poder = cargas (max 5).'},
    {id:'brd',name:'Bomba Radiacao',power:1,type:'Energia',target:'all_enemy',recharge:true,desc:'Radiacao: 4 dano/turno por 2 turnos. Acumula ate 4x.'},
  ]},
  {id:'kael',name:'Kael Vorn',suit:'spades',atq:4,def:2,inc:0,pvs:120,skills:[
    {id:'smt',name:'Soco Metalico',power:4,type:'Corporal',target:'enemy',recharge:false,desc:''},
    {id:'cpr',name:'Corte Preciso',power:'2/2',type:'Cortante',target:'enemy',recharge:false,desc:'Sangramento: 3 dano/turno por 2 turnos. Acumula ate 3x.'},
    {id:'fur',name:'Ataque de Furia',power:1,type:'Cortante',target:'all_enemy',recharge:true,desc:'Em Furia: contra-ataque sem custo de carta.'},
  ]},
  {id:'tyre',name:'Tyren',suit:'hearts',atq:2,def:4,inc:0,pvs:130,skills:[
    {id:'aes',name:'Avanco Espada',power:3,type:'Cortante',target:'enemy',recharge:false,desc:'Acumulo: 1a = Ignora Armadura. 2a = Atinge todos.'},
    {id:'aec',name:'Avanco Escudo',power:3,type:'Corporal',target:'enemy',recharge:false,desc:'Exposto: -50% DEF base do alvo por 2 turnos.'},
    {id:'rou',name:'Roupas Encantadas',power:0,type:'Melhoria',target:'self',recharge:true,desc:'Verde: regenera. Azul: protege aliados. Vermelha: contra-ataca. Acao Rapida.'},
  ]},
  {id:'lori',name:'Lorien',suit:'spades',atq:3,def:2,inc:1,pvs:110,skills:[
    {id:'lin',name:'Lanca Infernal',power:4,type:'Perfurante',target:'enemy',recharge:false,desc:'Exposto: -50% DEF base do alvo por 2 turnos.'},
    {id:'fli',name:'Flecha Imperial',power:3,type:'Distancia',target:'enemy',recharge:false,desc:'Enfraquecido: -50% ATQ base do alvo por 2 turnos.'},
    {id:'uni',name:'Investida Unicornio',power:5,type:'Invocacao',target:'all_enemy',recharge:true,desc:'Dobra dano com Exposto ou Enfraquecido.'},
  ]},
  {id:'nyxa',name:'Nyxar',suit:'diamonds',atq:3,def:3,inc:1,pvs:110,skills:[
    {id:'dad',name:'Dados Penetrantes',power:'1/1',type:'Distancia',target:'enemy',recharge:false,desc:'Ataque multiplo.'},
    {id:'mas',name:'Mascara de Faces',power:0,type:'Melhoria',target:'self',recharge:true,desc:'Feliz: contra-ataque. Triste: ataque conjunto.'},
    {id:'azs',name:'Azar ou Sorte',power:15,type:'Magico',target:'all',recharge:true,desc:'Par = cura. Impar = dano. Afeta TODOS.'},
  ]},
  {id:'pt_aer',name:'Aeryn',suit:'neutral',atq:3,def:3,inc:1,pvs:120,skills:[
    {id:'eli2',name:'Eliminar',power:6,type:'Cortante',target:'enemy',recharge:false,desc:'Explora Exposto: remove e causa dano dobrado.'},
    {id:'sab',name:'Saba',power:0,type:'Melhoria',target:'all_ally',recharge:false,desc:'Fortalecido: +50% ATQ para todos aliados por 2 turnos.'},
    {id:'tiz',name:'Espirito do Tigre',power:2,type:'Invocacao',target:'all_enemy',recharge:true,desc:'Sangramento em todos os inimigos.'},
  ]},
  {id:'pt_cae',name:'Caeryn',suit:'hearts',atq:4,def:5,inc:0,pvs:120,skills:[
    {id:'esp',name:'Espada do Poder',power:'2/2',type:'Cortante',target:'enemy',recharge:false,desc:'Ataque multiplo.'},
    {id:'lzv',name:'Corte Flamejante',power:3,type:'Fogo',target:'enemy',recharge:false,desc:'Aplica Queimadura.'},
    {id:'trz',name:'Espirito da Salamandra',power:'2/2',type:'Invocacao',target:'all_enemy',recharge:true,desc:'Aplica Derreter Armadura em todos.'},
  ]},
  {id:'pt_elo',name:'Elowen',suit:'diamonds',atq:3,def:3,inc:1,pvs:100,skills:[
    {id:'arc2',name:'Arco do Poder',power:1,type:'Perfurante',target:'enemy',recharge:false,desc:''},
    {id:'lzr',name:'Disparo Elfico',power:5,type:'Energia',target:'enemy',recharge:true,desc:''},
    {id:'ptz',name:'Espirito do Grifo',power:2,type:'Melhoria',target:'all_ally',recharge:true,desc:'Escudo para aliados.'},
  ]},
  {id:'pt_zar',name:'Zarae',suit:'clubs',atq:4,def:4,inc:3,pvs:110,skills:[
    {id:'atg',name:'Atagas do Poder',power:'1/1',type:'Cortante',target:'enemy',recharge:false,desc:'Ataque multiplo.'},
    {id:'lza',name:'Corte Estatico',power:3,type:'Eletrico',target:'enemy',recharge:true,desc:'Aplica Estatica.'},
    {id:'dsz',name:'Espirito do Guepardo',power:1,type:'Invocacao',target:'all_enemy',recharge:true,desc:'Acao Rapida.'},
  ]},
  {id:'pt_var',name:'Varok',suit:'spades',atq:6,def:3,inc:1,pvs:100,skills:[
    {id:'mch',name:'Machado do Poder',power:6,type:'Cortante',target:'enemy',recharge:false,desc:''},
    {id:'lzp',name:'Soco Brutal',power:3,type:'Energia',target:'enemy',recharge:true,desc:'Enfraquecido: -50% ATQ por 2 turnos.'},
    {id:'msz',name:'Espirito do Gorila',power:1,type:'Terrestre',target:'all_enemy',recharge:true,desc:'Atordoamento: 50% de perder o turno.'},
  ]},
  {id:'pt_tha',name:'Thalion',suit:'hearts',atq:2,def:7,inc:1,pvs:120,skills:[
    {id:'lnp',name:'Lanca do Poder',power:6,type:'Perfurante',target:'enemy',recharge:false,desc:''},
    {id:'lzaz',name:'Corte Gelido',power:3,type:'Frio',target:'enemy',recharge:true,desc:'Resfriamento: 10 dano + -1 Poder por 2 turnos.'},
    {id:'tcz',name:'Espirito do Urso Polar',power:2,type:'Invocacao',target:'all_enemy',recharge:true,desc:'+3 poder por debuff ativo no alvo.'},
  ]},
  {id:'voss',name:'Van Carl Voss',suit:'clubs',atq:4,def:2,inc:3,pvs:100,skills:[
    {id:'tei',name:'Chicote Paralisante',power:'2/2/2',type:'Distancia',target:'enemy',recharge:false,desc:'Lento: recarga inimiga vira L por 1 turno.'},
    {id:'sen',name:'Instinto Reflexivo',power:0,type:'Melhoria',target:'self',recharge:true,desc:'Esquiva proximo ataque unico. Se esquivar, ganha rodada extra.'},
    {id:'web',name:'Tiro Decisivo',power:'3/3',type:'Corporal',target:'enemy',recharge:true,desc:'Dobra dano em inimigos com Lento.'},
  ]},
];

// Busca personagem por ID
function getCharById(id) {
  return CHARS.find(function(c) { return c.id === id; });
}

module.exports = { CHARS, SUIT_ADV, getCharById };
