// ══════════════════════════════════════════════
// HUNTIFY — DATA.JS
// Mis à jour manuellement chaque matin
// Dernière mise à jour : 03/06/2026
// ══════════════════════════════════════════════

const AMZ_TAG = "huntify21-21";
const amz = (k) => `https://www.amazon.fr/s?k=${encodeURIComponent(k)}&tag=${AMZ_TAG}`;

const PRODUCTS = [

  // ── MODE ──────────────────────────────────
  { id:"birkenstock", name:"Birkenstock Arizona Sandales", cat:"Mode", price:"67€", was:"92€", pct:"-27%", store:"Amazon", hot:true,
    img:"https://images.unsplash.com/photo-1603487742131-4160ec999306?w=400&q=80", url:amz("birkenstock arizona") },
  { id:"nike-am270", name:"Nike Air Max 270 Homme", cat:"Mode", price:"94€", was:"150€", pct:"-37%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&q=80", url:amz("nike air max 270") },
  { id:"north-face", name:"Veste The North Face Femme", cat:"Mode", price:"112€", was:"220€", pct:"-49%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=400&q=80", url:amz("veste north face femme") },
  { id:"sac-cabas", name:"Sac Cabas Tendance Femme", cat:"Mode", price:"34€", was:"60€", pct:"-43%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=400&q=80", url:amz("sac cabas femme") },
  { id:"adidas-samba", name:"Adidas Samba OG Sneakers", cat:"Mode", price:"89€", was:"110€", pct:"-19%", store:"Amazon", hot:true,
    img:"https://images.unsplash.com/photo-1539185441755-769473a23570?w=400&q=80", url:amz("adidas samba og") },
  { id:"legging-sport", name:"Legging Sport Femme Taille Haute", cat:"Mode", price:"22€", was:"40€", pct:"-45%", store:"Amazon", hot:true,
    img:"https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", url:amz("legging sport femme taille haute") },
  { id:"crocs", name:"Crocs Classic Sabots Unisexe", cat:"Mode", price:"38€", was:"55€", pct:"-31%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=400&q=80", url:amz("crocs classic sabots") },
  { id:"nike-tshirt", name:"Nike Dri-FIT T-Shirt Sport Homme", cat:"Mode", price:"24€", was:"35€", pct:"-31%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&q=80", url:amz("nike dri fit tshirt homme") },

  // ── SANTÉ ─────────────────────────────────
  { id:"omega3", name:"Oméga-3 Premium 90 capsules", cat:"Santé", price:"14€", was:"32€", pct:"-56%", store:"Amazon", hot:true,
    img:"https://images.unsplash.com/photo-1550572017-edd951b55104?w=400&q=80", url:amz("omega 3 capsules") },
  { id:"vitd3k2", name:"Vitamines D3 + K2 — 365 gélules", cat:"Santé", price:"12€", was:"24€", pct:"-50%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1607619056574-7b8d3ee536b2?w=400&q=80", url:amz("vitamine d3 k2") },
  { id:"collagene", name:"Collagène Marin Hydrolysé 500g", cat:"Santé", price:"22€", was:"45€", pct:"-51%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&q=80", url:amz("collagene marin") },
  { id:"magnesium", name:"Magnésium Bisglycinate 120 gél.", cat:"Santé", price:"16€", was:"29€", pct:"-45%", store:"Amazon", hot:true,
    img:"https://images.unsplash.com/photo-1607620842762-50f70c14f6a8?w=400&q=80", url:amz("magnesium bisglycinate") },
  { id:"creatine", name:"Créatine Monohydrate Poudre 500g", cat:"Santé", price:"18€", was:"30€", pct:"-40%", store:"Amazon", hot:true,
    img:"https://images.unsplash.com/photo-1593095948071-474c5cc2989d?w=400&q=80", url:amz("creatine monohydrate poudre") },
  { id:"proteines", name:"Whey Protéine Chocolat 1kg", cat:"Santé", price:"28€", was:"45€", pct:"-38%", store:"Amazon", hot:true,
    img:"https://images.unsplash.com/photo-1547592180-85f173990554?w=400&q=80", url:amz("whey proteine chocolat 1kg") },
  { id:"tensiometre", name:"Tensiomètre Électronique Bras", cat:"Santé", price:"29€", was:"55€", pct:"-47%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=400&q=80", url:amz("tensiometre electronique bras") },
  { id:"masque-sommeil", name:"Masque Sommeil 3D Anti-Lumière", cat:"Santé", price:"12€", was:"20€", pct:"-40%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1519415510236-718bdfcd89c8?w=400&q=80", url:amz("masque sommeil 3d") },
  { id:"bouchons-oreilles", name:"Bouchons d'Oreilles Alpine Sleep", cat:"Santé", price:"16€", was:"25€", pct:"-36%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1583394293214-d5a6b47a4b7b?w=400&q=80", url:amz("bouchons oreilles sommeil alpine") },

  // ── ÉLECTRONIQUE ──────────────────────────
  { id:"sony-xm5", name:"Sony WH-1000XM5 Casque ANC", cat:"Électronique", price:"279€", was:"420€", pct:"-34%", store:"Amazon", hot:true,
    img:"https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&q=80", url:amz("sony wh-1000xm5") },
  { id:"samsung-a55", name:"Samsung Galaxy A55 5G 128Go", cat:"Électronique", price:"299€", was:"449€", pct:"-33%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=400&q=80", url:amz("samsung galaxy a55") },
  { id:"ipad10", name:"Apple iPad 10e génération 64Go", cat:"Électronique", price:"359€", was:"499€", pct:"-28%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=400&q=80", url:amz("apple ipad 10 generation") },
  { id:"amazfit", name:"Amazfit GTR 4 Montre Connectée", cat:"Électronique", price:"89€", was:"180€", pct:"-51%", store:"Amazon", hot:true,
    img:"https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80", url:amz("amazfit gtr 4") },
  { id:"airpods-pro", name:"Apple AirPods Pro 2e génération", cat:"Électronique", price:"199€", was:"279€", pct:"-29%", store:"Amazon", hot:true,
    img:"https://images.unsplash.com/photo-1603351154351-5e2d0600bb77?w=400&q=80", url:amz("apple airpods pro 2") },
  { id:"kindle", name:"Amazon Kindle Paperwhite 16Go", cat:"Électronique", price:"149€", was:"179€", pct:"-17%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&q=80", url:amz("kindle paperwhite 16go") },
  { id:"chargeur-rapide", name:"Chargeur Rapide USB-C 65W Anker", cat:"Électronique", price:"28€", was:"45€", pct:"-38%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=400&q=80", url:amz("chargeur rapide usb-c 65w anker") },
  { id:"camera-ring", name:"Ring Video Doorbell Sonnette HD", cat:"Électronique", price:"59€", was:"99€", pct:"-40%", store:"Amazon", hot:true,
    img:"https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80", url:amz("ring video doorbell sonnette") },
  { id:"echo-dot", name:"Amazon Echo Dot 5e génération", cat:"Électronique", price:"39€", was:"59€", pct:"-34%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1543512214-318c7553f230?w=400&q=80", url:amz("amazon echo dot 5") },
  { id:"robot-aspirateur", name:"Roomba Aspirateur Robot i3", cat:"Électronique", price:"199€", was:"349€", pct:"-43%", store:"Amazon", hot:true,
    img:"https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&q=80", url:amz("roomba aspirateur robot i3") },

  // ── MAISON ────────────────────────────────
  { id:"cafetiere", name:"DeLonghi Cafetière Expresso", cat:"Maison", price:"89€", was:"149€", pct:"-40%", store:"Amazon", hot:true,
    img:"https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&q=80", url:amz("delonghi cafetiere expresso") },
  { id:"friteuse-air", name:"Philips Airfryer Friteuse Sans Huile", cat:"Maison", price:"79€", was:"130€", pct:"-39%", store:"Amazon", hot:true,
    img:"https://images.unsplash.com/photo-1585515320310-259814833e62?w=400&q=80", url:amz("philips airfryer friteuse sans huile") },
  { id:"bouteille-isotherme", name:"Bouteille Isotherme Stanley 1L", cat:"Maison", price:"35€", was:"55€", pct:"-36%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=400&q=80", url:amz("bouteille isotherme stanley 1l") },
  { id:"lampe-bureau", name:"Lampe Bureau LED Tactile Rechargeable", cat:"Maison", price:"24€", was:"40€", pct:"-40%", store:"Amazon", hot:false,
    img:"https://images.unsplash.com/photo-1534073828943-f801091bb18c?w=400&q=80", url:amz("lampe bureau led tactile rechargeable") },

];
