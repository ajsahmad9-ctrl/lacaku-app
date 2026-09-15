# Catatan: Sinkronisasi "Resi Bermasalah" & "Monitoring Retur" di Lacaku

Status: **usulan, belum dikerjakan** — ditulis dulu supaya jelas sebelum masuk implementasi.

## 1. Masalah yang ditemukan

Lacaku punya dua alur import data yang berjalan sendiri-sendiri:

- **Import Data** (menu Admin/CS) — impor resi bermasalah dari menu "Butuh Perhatian" di agregator, lalu ditindaklanjuti lewat Follow Up (FU) berjenjang via WhatsApp.
- **Monitoring Retur** (menu Admin Gudang/Supplier) — impor data retur dari menu "Retur"/"Returned to Sender" di agregator, dipakai untuk koordinasi dengan supplier & pengajuan klaim.

Di kodenya, dua data ini memang **sengaja dibuat terpisah dan tidak saling memengaruhi** satu sama lain.

**Yang jadi masalah:** dari pengecekan data ekspor asli (file resi bermasalah 721 baris & file retur 160 baris, periode yang sama), ternyata **100% No. Order di file retur sudah ada juga di file resi bermasalah** — jadi ini bukan dua kelompok order yang berbeda, tapi order yang **sama**, cuma statusnya berubah seiring waktu (mulai dari "Butuh Perhatian" → di-FU → kalau gagal diselamatkan → jadi "Returned to Sender").

Karena Lacaku memperlakukan keduanya sebagai data terpisah, akibatnya:
- CS bisa saja terus mengirim FU ke resi yang sebenarnya **sudah pasti retur** (buang waktu & bisa mengganggu customer yang sebenarnya sudah tidak relevan lagi dihubungi).
- Laporan seperti Rescue Rate berpotensi kurang akurat, karena ada resi yang "nyangkut" statusnya padahal hasil akhirnya sudah jelas.
- User harus melihat/mengelola resi yang sama di dua tempat tanpa ada penanda bahwa itu order yang sama.

## 2. Kenapa TIDAK diusulkan digabung jadi satu data saja

Alasan pemisahan CS/Admin vs Supplier/Admin Gudang di Lacaku kelihatannya memang sengaja: **Supplier adalah pihak luar/partner**, jadi tidak semestinya bisa melihat riwayat chat follow-up CS ke customer (data itu sifatnya internal). Kalau dua data ini digabung total jadi satu, ada risiko Supplier jadi ikut bisa melihat hal yang bukan wewenangnya.

Jadi solusi "gabung semua jadi satu data" **tidak disarankan**, karena bisa merusak batasan akses yang sudah ada.

## 3. Solusi yang diusulkan: sambungkan tanpa menggabungkan

Tetap dua alur import yang terpisah seperti sekarang, tapi Lacaku ditambah kemampuan **mengenali kalau No. Resi yang di-import ke Monitoring Retur ternyata sudah ada di data resi bermasalah**. Kalau ketemu kecocokan:

- **Di sisi CS/Admin:** resi itu otomatis ditandai "sudah retur" dan dikeluarkan dari antrean follow-up aktif — supaya CS tidak lagi buang waktu mengirim FU ke resi yang hasilnya sudah pasti.
- **Di sisi Supplier/Admin Gudang:** tidak ada perubahan tampilan — Supplier tetap tidak melihat detail chat/riwayat FU milik CS. Penyambungan ini hanya dipakai di belakang layar untuk akurasi data, bukan untuk membuka akses baru.
- **Laporan/analitik** (Rescue Rate, dll.) jadi lebih akurat karena tidak ada resi yang statusnya "nyangkut"/tidak sinkron.

## 4. Yang TIDAK berubah dari usulan ini

User (Admin Gudang) **tetap harus export & import dua kali** dari agregator (satu dari menu "Butuh Perhatian", satu dari menu "Retur") — itu keterbatasan dari sisi agregatornya sendiri (tidak ada API/feed gabungan), bukan sesuatu yang bisa diperbaiki dari sisi Lacaku. Yang diperbaiki cuma bagaimana Lacaku memperlakukan data itu **setelah** kedua-duanya di-import.

## 5. Urutan pengerjaan yang disarankan

Ini perbaikan kualitas data yang bagus, tapi **tidak menghalangi** sistem tier/langganan (Free/Starter/Growth/Business) untuk mulai jalan. Disarankan: selesaikan dulu sistem tier & kuota yang sudah dirancang (lihat ringkasan di bawah), baru masuk ke perbaikan sinkronisasi ini di tahap berikutnya.

---

## Lampiran: ringkasan keputusan tier & kuota (untuk konteks)

| Paket | Harga/bulan | Fitur |
|---|---|---|
| Free | Rp0 | 1 akun, resi bermasalah & FU (kuota 100/bulan, tervalidasi dari data real ≈180 order/bulan), Monitoring Retur (kuota 40/bulan), riwayat resi 30 hari |
| Starter | Rp149.000 | Semua fitur Free tanpa batas kuota + Template Pesan, Riwayat Follow Up, 3-5 akun CS |
| Growth | Rp249.000 | + Analitik Retur, Performa CS, Aktivitas CS Harian, Manajemen CS, Lokasi Gudang, Klaim Ekspedisi (Admin) |
| Business | Rp449.000 | + akun CS/tim unlimited, multi-gudang tanpa batas, prioritas dukungan |

Status Scalev: `SCALEV_API_KEY` sudah terpasang di Railway. `SCALEV_CHECKOUT_URL` masih perlu dibuat (produk paket langganan belum ada di Scalev). `OWNER_EMAILS` (akses evaluasi pemilik tanpa bayar) sudah aktif untuk ajsahmad9@gmail.com.
