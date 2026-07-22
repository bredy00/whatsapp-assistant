# WhatsApp Asistanı — Operatör Kılavuzu (Türkçe)

Bu kılavuz, servisi işleten operatör için günlük işlemleri özetler. Teknik
ayrıntılar ve İngilizce sürüm için `docs/RUNBOOK.md` dosyasına bakın.

---

## 1. Hızlı teşhis — "bot cevap vermiyor"

```bash
npm run whatsapp:diagnose                 # canlı Meta Graph API'ye karşı teşhis
npm run whatsapp:diagnose -- --send --to +905551112233   # gerçek gönderim testi
```

En sık iki neden:

- **131030** — alıcı, test numarasının izinli listesinde değil. Meta
  Developers → WhatsApp → API Setup ekranından numarayı ekleyip doğrulayın
  (test numarası için en fazla 5 numara).
- **190** — erişim tokenı süresi dolmuş. Kalıcı bir System User tokenı
  oluşturun (Business Settings → System users) ve Render'da
  `WHATSAPP_ACCESS_TOKEN` değerini güncelleyin.

Her testerin ayrıca uygulama veritabanında whitelist'te olması gerekir
(bkz. 2. bölüm).

---

## 2. Kullanıcı whitelist yönetimi (komut satırı)

```bash
# Tek kullanıcı ekle
npm run db:add-user -- \
  --phone "+905551112233" \
  --name "Ad Soyad" \
  --department "Sales" \
  --role employee \
  --locale tr \
  --permissions "company.sales"

# Toplu ekleme (JSON dosyasından, hepsi tek işlemde)
npm run db:whitelist-batch -- --file kullanicilar.json

# Kullanıcıyı pasifleştir
npm run db:set-user-active -- --phone "+905551112233" --active false

# Whitelist'i görüntüle (telefonlar maskeli; --full ile açık)
npm run db:list-users
npm run db:list-users -- --full
```

`kullanicilar.json` biçimi:

```json
[
  { "phone": "+905551112233", "name": "Ada", "role": "employee",
    "department": "Sales", "locale": "tr", "permissions": ["company.sales"] }
]
```

Roller: `employee`, `manager`, `executive`, `admin`. İzinler: `company.sales`,
`company.projects`, `company.tasks`.

---

## 3. WhatsApp üzerinden yönetici whitelist komutu (isteğe bağlı)

Yönetici, kullanıcıyı doğrudan WhatsApp'tan ekleyebilir. **Varsayılan olarak
kapalıdır** çünkü çalışan servise whitelist yazma yetkisi verir.

**Kullanım** (tetikleyici `whitelist` veya `yetkilendir`):

```
whitelist +905551112233 name="Ad Soyad" role=employee dept=Sales locale=tr perms=company.sales
```

`role` verilmezse `employee` olur; `dept`, `locale`, `perms` isteğe bağlıdır.

**Etkinleştirmek için üçü de gereklidir:**

1. **Veritabanı yetkisi:**
   `APP_ROLE_ALLOW_WHITELIST_WRITE=true npm run db:provision-app-role -- --confirm-dedicated-database`
2. **Çalışma zamanı bayrağı:** `WHATSAPP_ADMIN_COMMANDS_ENABLED=true`
3. **İzin:** güvenilir yöneticiye `permissions` tablosunda `admin.whitelist`
   (action `write`) verin.

**Davranış:** yönetici olmayan biri bu komutu yazarsa hiçbir yanıt almaz ve
hiçbir kayıt tutulmaz — komut onlar için tamamen etkisizdir (sıradan bir
mesajdan ayırt edilemez). Her başarılı ekleme tek işlemde hem alıcıyı
(`identity.whitelist_update`) hem işlemi yapan yöneticiyi
(`identity.whitelist_admin_action`) denetim kaydına yazar.

**Kapatmak için:** bayraklardan birini kaldırın; rolü yetkisiz yeniden
sağlayarak servisi tekrar salt-okunur yapın.

---

## 4. Kullanıcı kendi kendine servis komutları

Whitelist'teki kullanıcılar WhatsApp'tan şunları yazabilir:

- **`gizlilik`** — hangi verilerin tutulduğunu açıklayan bilgilendirme.
- **`verilerimi sil`** — silme (KVKK/GDPR) talebi; denetim kaydına düşer.
- **`erişim istiyorum`** — erişim talebi; denetim kaydına düşer.
- **`menü`** (veya `yardım`, `?`) — yetkiye göre rapor menüsü (1 = satış,
  2 = projeler, 3 = geciken görevler).

Operatör, gelen talepleri görüntüler ve `db:add-user` / `db:erase-user-data`
ile işleme alır:

```bash
npm run db:list-access-requests            # son 14 gün, maskeli telefonlar
npm run db:list-access-requests -- --days 30 --full
```

---

## 5. Güvenlik özellikleri

- **Kötüye kullanım kilidi:** bir gönderici dakikada
  `ABUSE_LOCKOUT_THRESHOLD_PER_MINUTE` (varsayılan 10) sınırını aşan yetkisiz
  mesaj atarsa kalan süre boyunca sessizce yok sayılır. `whatsapp.lockout`
  olarak denetlenir; `/health` üzerinde `lockedOutSenders` sayısı görünür.
- **Replay koruması:** `WEBHOOK_MESSAGE_MAX_AGE_SECONDS` > 0 ise Meta zaman
  damgası pencere dışındaki webhook mesajları reddedilir (imza kontrolüne ek).
- **İmzalı olay bildirimleri:** `INTEGRATION_WEBHOOK_URL` +
  `INTEGRATION_WEBHOOK_SECRET` ayarlıysa kilitlenme ve kalıcı gönderim
  hataları, gövde üzerinden HMAC (`x-assistant-signature`) ile imzalanıp POST
  edilir. Varsayılan kapalıdır; asıl akışı asla bloke etmez.

---

## 6. Günlük operasyon

```bash
npm run ops:status            # veritabanından tek komutla durum özeti
npm run db:export-audit -- --days 90 --format csv   # denetim kaydı dışa aktarımı
```

- `ASSISTANT_LOCALE` (tr / en) botun kendi bildirimlerinin dilini belirler;
  kullanıcı bazında `db:add-user -- ... --locale en` ile geçersiz kılınabilir.
- `GET /health/whatsapp` (`x-ops-token: <WHATSAPP_VERIFY_TOKEN>` başlığıyla) —
  canlı Meta yapılandırma sağlığı: doğrulanmış ad, kalite notu, token süresi.

---

## 7. Dağıtım (deploy) notları

- Yeni sürümde bekleyen migration'ları uygulayın: `npm run db:migrate`.
- Render ortam değişkenleri için `docs/RUNBOOK.md` §5 dağıtım kontrol listesine
  bakın. Yeni bayraklar varsayılan kapalıdır; ihtiyaç oldukça açın.
