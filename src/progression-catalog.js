/** Freeze nested catalog records so rendering cannot accidentally change prices or rewards. */
function deepFreeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }

// Authored build-time catalog. No remote request, payment product or SDK dependency.
export const CATALOG = deepFreeze({
  "schemaVersion": 1,
  "status": "implementation_proposal_not_live_analytics",
  "brand": {
    "ru": "Roadster",
    "en": "Roadster",
    "taglineRu": "Держи трассу. Забирай небо.",
    "palette": {
      "graphite": "#20282B",
      "chalk": "#EEE6D7",
      "orange": "#F17740",
      "glacier": "#9DCAD1"
    }
  },
  "sections": [
    "fleet",
    "style",
    "engineering",
    "contracts",
    "season"
  ],
  "currency": {
    "id": "credits",
    "labelRu": "кредиты",
    "startingBalance": 300,
    "purchasableWithRealMoney": false
  },
  "runRewards": {
    "metresPerCredit": 10,
    "creditsPerRoadEvent": 20,
    "creditsPerPrecisionLanding": 10,
    "goalMetres": 1500,
    "goalCredits": 40,
    "landingRewardMinimumGroundMetres": 120,
    "maxRewardedLandingsPerKilometre": 3
  },
  "onboardingGrant": {
    "id": "first_500m",
    "minimumRunMetres": 500,
    "credits": 200,
    "oncePerProfile": true
  },
  "ads": {
    "rewarded": {
      "id": "result_bonus",
      "creditFraction": 0.25,
      "maximumCredits": 100,
      "minimumRunMetres": 500,
      "onePerFinalizedRun": true,
      "grantsXp": false,
      "grantsRecordScore": false
    },
    "interstitial": {
      "minimumCompletedRuns": 3,
      "minimumSessionSeconds": 180,
      "minimumSecondsBetweenRequests": 180,
      "skipAfterRewardedSeconds": 180,
      "allowedTransitions": [
        "results_to_next",
        "results_to_garage"
      ],
      "onStartup": false,
      "policyNote": "Our product cadence, not a platform-mandated cap."
    }
  },
  "garageLevels": [
    {
      "level": 1,
      "id": "bay",
      "nameRu": "Бокс",
      "incrementalPrice": 0,
      "cosmeticPresetSlots": 1,
      "displayCarSlots": 1,
      "art": "Concrete service bay, tool cart, bench, roof-window daylight."
    },
    {
      "level": 2,
      "id": "workshop",
      "nameRu": "Мастерская",
      "incrementalPrice": 900,
      "cosmeticPresetSlots": 3,
      "displayCarSlots": 2,
      "art": "Open adjoining bay, tyre rack, articulated work lamp, wall colour customization."
    },
    {
      "level": 3,
      "id": "test_shop",
      "nameRu": "Испытательный цех",
      "incrementalPrice": 2700,
      "cosmeticPresetSlots": 6,
      "displayCarSlots": 3,
      "art": "Visible inspection pit/lift, dyno floor rollers, flight-control bench and trophy rail."
    },
    {
      "level": 4,
      "id": "aero_hangar",
      "nameRu": "Аэрогараж",
      "incrementalPrice": 6000,
      "cosmeticPresetSlots": 10,
      "displayCarSlots": 3,
      "art": "Hangar doors open to mountain runway, overhead gantry, mezzanine and authored lighting presets."
    }
  ],
  "fleet": [
    {
      "id": "rocket",
      "nameRu": "Roadster Rocket",
      "asset": "roadster.glb",
      "price": 0,
      "ownedAtStart": true,
      "flight": true,
      "cockpit": true,
      "maxSpeedMps": 52,
      "accelerationMps2": 8,
      "brakeDecelerationMps2": 19,
      "steeringSlewMultiplier": 1,
      "lengthM": 4.7,
      "widthM": 2.36,
      "heightM": 1.35,
      "recordClass": "rocket",
      "roleRu": "Стартовый экспериментальный родстер: разгон, короткий полёт, точная посадка.",
      "rightsStatus": "Existing target model retained; commercial design/trademark clearance not established."
    },
    {
      "id": "hatch",
      "nameRu": "Клин H2",
      "asset": "traffic/hatch.glb",
      "price": 1400,
      "ownedAtStart": false,
      "flight": false,
      "cockpit": false,
      "maxSpeedMps": 44,
      "accelerationMps2": 8.4,
      "brakeDecelerationMps2": 20.5,
      "steeringSlewMultiplier": 1.1,
      "lengthM": 4.08,
      "widthM": 1.86,
      "heightM": 1.52,
      "recordClass": "hatch",
      "roleRu": "Компактный манёвренный хэтчбек для точных наземных траекторий."
    },
    {
      "id": "sedan",
      "nameRu": "Вектор S4",
      "asset": "traffic/sedan.glb",
      "price": 2600,
      "ownedAtStart": false,
      "flight": false,
      "cockpit": false,
      "maxSpeedMps": 48,
      "accelerationMps2": 7.5,
      "brakeDecelerationMps2": 19.5,
      "steeringSlewMultiplier": 1,
      "lengthM": 4.65,
      "widthM": 1.94,
      "heightM": 1.46,
      "recordClass": "sedan",
      "roleRu": "Стабильный дорожный седан для длинных чистых отрезков."
    },
    {
      "id": "suv",
      "nameRu": "Гребень U6",
      "asset": "traffic/suv.glb",
      "price": 4200,
      "ownedAtStart": false,
      "flight": false,
      "cockpit": false,
      "maxSpeedMps": 42,
      "accelerationMps2": 6.8,
      "brakeDecelerationMps2": 18.5,
      "steeringSlewMultiplier": 0.92,
      "lengthM": 4.82,
      "widthM": 2.04,
      "heightM": 1.88,
      "recordClass": "suv",
      "roleRu": "Тяжёлый экспедиционный класс: плавное управление и отдельные испытания."
    },
    {
      "id": "van",
      "nameRu": "Марш V8",
      "asset": "traffic/van.glb",
      "price": 6000,
      "ownedAtStart": false,
      "flight": false,
      "cockpit": false,
      "maxSpeedMps": 38,
      "accelerationMps2": 5.8,
      "brakeDecelerationMps2": 17,
      "steeringSlewMultiplier": 0.86,
      "lengthM": 5.62,
      "widthM": 2.18,
      "heightM": 2.58,
      "recordClass": "van",
      "roleRu": "Фургон точной доставки, отдельный класс, не более сильная замена родстеру."
    }
  ],
  "engineering": {
    "scope": "shared_research_per_profile_configurable_per_car",
    "levels": [
      0,
      1,
      2,
      3,
      4,
      5
    ],
    "incrementalCosts": [
      120,
      240,
      420,
      700,
      1100
    ],
    "branches": [
      {
        "id": "drive",
        "nameRu": "Тяга",
        "parameter": "accelerationMultiplier",
        "values": [
          1,
          1.02,
          1.04,
          1.06,
          1.08,
          1.1
        ],
        "supports": [
          "rocket",
          "hatch",
          "sedan",
          "suv",
          "van"
        ]
      },
      {
        "id": "brakes",
        "nameRu": "Торможение",
        "parameter": "brakeDecelerationMultiplier",
        "values": [
          1,
          1.03,
          1.06,
          1.09,
          1.12,
          1.15
        ],
        "supports": [
          "rocket",
          "hatch",
          "sedan",
          "suv",
          "van"
        ]
      },
      {
        "id": "chassis",
        "nameRu": "Рулевой отклик",
        "parameter": "steeringSlewMultiplier",
        "values": [
          1,
          1.02,
          1.04,
          1.06,
          1.08,
          1.1
        ],
        "supports": [
          "rocket",
          "hatch",
          "sedan",
          "suv",
          "van"
        ]
      },
      {
        "id": "flight",
        "nameRu": "Эффективность сопел",
        "parameter": "flightDrainMultiplier",
        "values": [
          1,
          0.98,
          0.96,
          0.94,
          0.92,
          0.9
        ],
        "supports": [
          "rocket"
        ]
      }
    ],
    "unchanged": [
      "topSpeed",
      "collisionEnvelope",
      "liftCeiling",
      "landingReserveCost",
      "landingReserveTime",
      "rollCost"
    ],
    "stockRecordModeIgnoresUpgrades": true,
    "refunds": false,
    "instantFreeEquipOwnedLevels": true
  },
  "cosmetics": [
    {
      "id": "paint_chalk",
      "slot": "body.paint",
      "nameRu": "Мел",
      "price": 0,
      "cars": "all",
      "implementation": "body material tint",
      "boxLevel": 1
    },
    {
      "id": "paint_graphite",
      "slot": "body.paint",
      "nameRu": "Графит",
      "price": 0,
      "cars": "all",
      "implementation": "body material tint",
      "boxLevel": 1
    },
    {
      "id": "paint_copper",
      "slot": "body.paint",
      "nameRu": "Горячая медь",
      "price": 150,
      "cars": "all",
      "implementation": "body material tint",
      "boxLevel": 1
    },
    {
      "id": "paint_glacier",
      "slot": "body.paint",
      "nameRu": "Ледник",
      "price": 240,
      "cars": "all",
      "implementation": "body material tint",
      "boxLevel": 1
    },
    {
      "id": "finish_satin",
      "slot": "body.finish",
      "nameRu": "Сатин",
      "price": 320,
      "cars": "all",
      "implementation": "isolated roughness/clearcoat material settings",
      "boxLevel": 1
    },
    {
      "id": "rim_graphite",
      "slot": "wheels.finish",
      "nameRu": "Тёмный металл",
      "price": 180,
      "cars": "all",
      "implementation": "clone compatible rim material, never alter tyre",
      "boxLevel": 1
    },
    {
      "id": "rim_copper",
      "slot": "wheels.finish",
      "nameRu": "Медный кант",
      "price": 300,
      "cars": "all",
      "implementation": "authored rim accent material slot",
      "boxLevel": 1
    },
    {
      "id": "wheel_turbine",
      "slot": "wheels.geometry",
      "nameRu": "Турбинные накладки",
      "price": 700,
      "cars": [
        "rocket",
        "hatch",
        "sedan"
      ],
      "implementation": "requires authored swappable wheel GLBs and per-car radius/clearance validation",
      "boxLevel": 2
    },
    {
      "id": "body_louver",
      "slot": "body.addon",
      "nameRu": "Жалюзи задней панели",
      "price": 650,
      "cars": [
        "rocket"
      ],
      "implementation": "requires authored mount points, retracting aero clearance and Blender geometry",
      "boxLevel": 2
    },
    {
      "id": "body_splitter",
      "slot": "body.addon",
      "nameRu": "Нижняя кромка",
      "price": 900,
      "cars": [
        "rocket"
      ],
      "implementation": "requires authored compatible splitter within unchanged collision envelope",
      "boxLevel": 3
    },
    {
      "id": "cockpit_amber",
      "slot": "cockpit.theme",
      "nameRu": "Янтарный приборный свет",
      "price": 220,
      "cars": [
        "rocket"
      ],
      "implementation": "instrument display palette only; readability preserved",
      "boxLevel": 1
    },
    {
      "id": "cockpit_glacier",
      "slot": "cockpit.theme",
      "nameRu": "Холодный полигон",
      "price": 350,
      "cars": [
        "rocket"
      ],
      "implementation": "instrument display palette only; readability preserved",
      "boxLevel": 1
    },
    {
      "id": "cockpit_stitch",
      "slot": "cockpit.trim",
      "nameRu": "Контрастная прострочка",
      "price": 600,
      "cars": [
        "rocket"
      ],
      "implementation": "requires authored upholstery material/mask",
      "boxLevel": 2
    },
    {"id":"rim_titanium","slot":"wheels.finish","nameRu":"Титан","price":210,"cars":"all","implementation":"isolated wheel metal finish; tyres and brakes unchanged","boxLevel":1},
    {"id":"rim_rose","slot":"wheels.finish","nameRu":"Розовый сплав","price":270,"cars":"all","implementation":"isolated wheel metal finish; tyres and brakes unchanged","boxLevel":1},
    {"id":"tint_light","slot":"body.tint","nameRu":"Лёгкая дымка","price":160,"cars":"all","implementation":"bounded instance-only glazing tint with restored cabin visibility","boxLevel":1,"opacity":0.78,"opacityIncrease":0.04,"tintColor":"#292933"},
    {"id":"tint_smoke","slot":"body.tint","nameRu":"Дымчатое стекло","price":260,"cars":"all","implementation":"bounded instance-only glazing tint; never opaque cockpit glass","boxLevel":1,"opacity":0.86,"opacityIncrease":0.12,"tintColor":"#17191f"},
    {"id":"steering_round","slot":"cockpit.steering","nameRu":"Круглый спорт","price":650,"cars":["rocket"],"implementation":"authored Blender steering assembly at the unchanged yoke pivot","boxLevel":1,"visual":{"variant":"round"}},
    {"id":"steering_yoke","slot":"cockpit.steering","nameRu":"Компактный штурвал","price":850,"cars":["rocket"],"implementation":"authored Blender steering assembly at the unchanged yoke pivot","boxLevel":2,"visual":{"variant":"yoke"}}
  ],
  "contracts": [
    {
      "id": "first_500m",
      "nameRu": "Первый рубеж",
      "kind": "lifetime_single_grant",
      "metric": "maxRunDistanceM",
      "target": 500,
      "credits": 200,
      "xp": 0,
      "sameGrantAsOnboarding": true,
      "requires": []
    },
    {
      "id": "road_10",
      "nameRu": "Читай дорогу",
      "kind": "milestone",
      "metric": "roadEventsCompleted",
      "target": 10,
      "credits": 300,
      "xp": 150,
      "requires": []
    },
    {
      "id": "land_3",
      "nameRu": "Точный возврат",
      "kind": "milestone",
      "metric": "precisionLandings",
      "target": 3,
      "credits": 250,
      "xp": 150,
      "requires": [
        "flight"
      ]
    },
    {
      "id": "distance_10k",
      "nameRu": "Свой маршрут",
      "kind": "milestone",
      "metric": "distanceM",
      "target": 10000,
      "credits": 400,
      "xp": 200,
      "requires": []
    },
    {
      "id": "clean_1500",
      "nameRu": "Чистая линия",
      "kind": "milestone",
      "metric": "maxCleanGroundSegmentM",
      "target": 1500,
      "credits": 350,
      "xp": 200,
      "requires": []
    },
    {
      "id": "sky_pass_10",
      "nameRu": "Над колонной",
      "kind": "milestone",
      "metric": "airborneOvertakes",
      "target": 10,
      "credits": 350,
      "xp": 200,
      "requires": [
        "flight"
      ]
    },
    {
      "id": "engineer_1",
      "nameRu": "Личная настройка",
      "kind": "milestone",
      "metric": "engineeringPurchases",
      "target": 1,
      "credits": 0,
      "xp": 100,
      "requires": []
    },
    {
      "id": "fleet_3",
      "nameRu": "Три характера",
      "kind": "milestone",
      "metric": "ownedCarCount",
      "target": 3,
      "credits": 500,
      "xp": 250,
      "requires": []
    },
    {
      "id": "repeat_distance",
      "nameRu": "Рабочий маршрут",
      "kind": "repeatable",
      "metric": "distanceM",
      "target": 6000,
      "credits": 180,
      "xp": 80,
      "requires": [],
      "carryExcess": true
    },
    {
      "id": "repeat_events",
      "nameRu": "Испытатель",
      "kind": "repeatable",
      "metric": "roadEventsCompleted",
      "target": 12,
      "credits": 140,
      "xp": 80,
      "requires": [],
      "carryExcess": true
    },
    {
      "id": "repeat_precision",
      "nameRu": "Мягкое касание",
      "kind": "repeatable",
      "metric": "precisionLandings",
      "target": 8,
      "credits": 140,
      "xp": 80,
      "requires": [
        "flight"
      ],
      "carryExcess": true
    }
  ],
  "season": {
    "id": "volume01",
    "nameRu": "Высота ноль",
    "levels": 20,
    "xpPerLevel": 450,
    "totalXp": 9000,
    "expiresAt": null,
    "archivedVolumeRemainsProgressable": true,
    "xp": {
      "metresPerXp": 50,
      "perRoadEvent": 10,
      "goalBonus": 20,
      "maximumPerRun": 450,
      "maximumDailyXp": null,
      "adsAwardXp": false
    },
    "premium": {
      "enabled": false,
      "reasonRu": "Премиальная линия недоступна: платёжный продукт ещё не подключён.",
      "sdkProductId": null,
      "currencyReward": 0,
      "performanceReward": 0,
      "oneTimeEntitlement": true,
      "retroactiveClaims": true
    },
    "freeRewards": [
      {
        "level": 1,
        "id": "v01_credit_01",
        "type": "credits",
        "amount": 150
      },
      {
        "level": 2,
        "id": "v01_badge_02",
        "type": "badge",
        "cosmeticId": "badge_first_altitude"
      },
      {
        "level": 3,
        "id": "v01_credit_03",
        "type": "credits",
        "amount": 150
      },
      {
        "level": 4,
        "id": "v01_paint_04",
        "type": "cosmetic",
        "cosmeticId": "paint_glacier"
      },
      {
        "level": 5,
        "id": "v01_credit_05",
        "type": "credits",
        "amount": 200
      },
      {
        "level": 6,
        "id": "v01_rim_06",
        "type": "cosmetic",
        "cosmeticId": "rim_copper"
      },
      {
        "level": 7,
        "id": "v01_credit_07",
        "type": "credits",
        "amount": 200
      },
      {
        "level": 8,
        "id": "v01_banner_08",
        "type": "badge",
        "cosmeticId": "banner_ground_to_air"
      },
      {
        "level": 9,
        "id": "v01_credit_09",
        "type": "credits",
        "amount": 250
      },
      {
        "level": 10,
        "id": "v01_cockpit_10",
        "type": "cosmetic",
        "cosmeticId": "cockpit_glacier"
      },
      {
        "level": 11,
        "id": "v01_credit_11",
        "type": "credits",
        "amount": 250
      },
      {
        "level": 12,
        "id": "v01_badge_12",
        "type": "badge",
        "cosmeticId": "badge_line_keeper"
      },
      {
        "level": 13,
        "id": "v01_credit_13",
        "type": "credits",
        "amount": 300
      },
      {
        "level": 14,
        "id": "v01_paint_14",
        "type": "cosmetic",
        "cosmeticId": "finish_satin"
      },
      {
        "level": 15,
        "id": "v01_credit_15",
        "type": "credits",
        "amount": 300
      },
      {
        "level": 16,
        "id": "v01_banner_16",
        "type": "badge",
        "cosmeticId": "banner_test_pilot"
      },
      {
        "level": 17,
        "id": "v01_credit_17",
        "type": "credits",
        "amount": 350
      },
      {
        "level": 18,
        "id": "v01_badge_18",
        "type": "badge",
        "cosmeticId": "badge_precision"
      },
      {
        "level": 19,
        "id": "v01_credit_19",
        "type": "credits",
        "amount": 350
      },
      {
        "level": 20,
        "id": "v01_trophy_20",
        "type": "trophy",
        "cosmeticId": "trophy_altitude_zero"
      }
    ],
    "duplicateCosmeticCompensation": {
      "policy": "If the exact reward was already bought with credits, refund its original paid soft-credit price once; never exchange for premium currency."
    }
  }
});
export const BRAND = CATALOG.brand;
export const SECTIONS = CATALOG.sections;
export const FLEET = CATALOG.fleet;
export const GARAGE_LEVELS = CATALOG.garageLevels;
export const ENGINEERING = CATALOG.engineering;
export const CONTRACTS = CATALOG.contracts;
export const SEASON = CATALOG.season;
export const RUN_REWARDS = CATALOG.runRewards;
export const ADS = CATALOG.ads;
export const BADGES = deepFreeze([
  {id:'badge_first_altitude',nameRu:'Первая высота',kind:'badge',symbol:'altitude'},
  {id:'banner_ground_to_air',nameRu:'С земли в небо',kind:'banner',symbol:'ground-to-air'},
  {id:'badge_line_keeper',nameRu:'Хранитель линии',kind:'badge',symbol:'line'},
  {id:'banner_test_pilot',nameRu:'Пилот испытаний',kind:'banner',symbol:'test-pilot'},
  {id:'badge_precision',nameRu:'Точное касание',kind:'badge',symbol:'precision'},
  {id:'trophy_altitude_zero',nameRu:'Высота ноль',kind:'trophy',symbol:'altitude-zero'},
]);
const authored = {wheel_turbine:'wheels.turbine',body_louver:'body.louver',body_splitter:'body.splitter',cockpit_stitch:'cockpit.stitch',rim_copper:'rims.copperAccent',steering_round:'cockpit.steeringRound',steering_yoke:'cockpit.steeringYoke'};
const colors = {paint_chalk:'#EEE6D7',paint_graphite:'#20282B',paint_copper:'#F17740',paint_glacier:'#9DCAD1',rim_graphite:'#343B40',rim_copper:'#B97745',rim_titanium:'#A8A5AF',rim_rose:'#B56683',cockpit_amber:'#FFB35C',cockpit_glacier:'#9DCAD1'};
export const COSMETICS = deepFreeze(CATALOG.cosmetics.map(item => ({...item,cars:['wheel_turbine','rim_copper'].includes(item.id)?['rocket']:item.cars,color:colors[item.id] || null,requiredCapability:authored[item.id] || null,status:authored[item.id] ? 'requires-authored' : 'available'})));
export const DEFAULT_CAPABILITIES = Object.freeze({});

/** Return only a known vehicle definition; unknown and prototype property names return null. */
export function vehicleDefinition(id) { return FLEET.find(item => item.id === id) || null; }
/** Find a supported cosmetic without interpreting object prototype properties as catalog entries. */
export function cosmeticDefinition(id) { return COSMETICS.find(item => item.id === id) || null; }
/** Gate unimplemented geometry/material slots until the caller supplies a verified authored capability. */
export function cosmeticAvailability(itemOrId, capabilities = DEFAULT_CAPABILITIES) {
  const item = typeof itemOrId === 'string' ? cosmeticDefinition(itemOrId) : itemOrId;
  if (!item || !COSMETICS.some(entry => entry.id === item.id)) return {available:false,reason:'Неизвестный предмет.'};
  if (item.requiredCapability && !(Object.hasOwn(capabilities,item.requiredCapability) && capabilities[item.requiredCapability] === true)) return {available:false,reason:'Готовится: необходима проверенная модель или материал для этой детали.'};
  return {available:true,reason:null};
}
