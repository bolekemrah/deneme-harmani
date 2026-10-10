# ÖSYM Referans Soru Veri Seti

Bu veri setinin amacı ÖSYM sorularını uygulamada kopyalayıp dağıtmak değil; izin/lisans koşulları gözetilerek soru yapısı ve kalite değerlendirmesini kalibre edecek bir referans katmanı oluşturmaktır.

## Her referans kayıt için alanlar

- `exam`: KPSS, TYT, AYT, ALES, DGS vb.
- `year`: sınav yılı
- `subject`: ders
- `topic`: konu/kazanım
- `question_type`: bilgi, yorum, paragraf, problem, çıkarım vb.
- `option_count`: seçenek sayısı
- `has_visual`: görsel/tablo/şekil gerektiriyor mu
- `reasoning_level`: düşük / orta / yüksek
- `language_clarity`: 0-100
- `distractor_quality`: 0-100
- `measurement_quality`: 0-100
- `difficulty`: kolay / orta / zor
- `source_verified`: kaynağın doğrulandığını gösterir
- `rights_status`: içeriğin kullanım/işleme durumunun kontrol kaydı

## Uygulama çıktısı

Bir PDF'den çıkarılan aday soru önce yapısal doğrulamadan geçer. Ardından AI/kalibrasyon katmanı şu çıktıyı üretir:

- gerçek soru olma güveni
- ders ve konu
- ÖSYM tarzına yakınlık
- dil/anlatım kalitesi
- çeldirici kalitesi
- ölçme değeri
- tahmini zorluk
- genel kalite puanı
- insan kontrolü gerekip gerekmediği

Doğru cevap yalnızca cevap anahtarı veya güvenilir kaynak ile doğrulanır. Model emin olmadığı doğru cevabı üretmez.

## Kabul ilkesi

A-B-C-D-E harflerinin bulunması tek başına soru kanıtı değildir. Anlamlı soru kökü, seçeneklerin aynı soruya ait olması, sayfa yerleşimi ve anlamsal tutarlılık birlikte değerlendirilmelidir.
