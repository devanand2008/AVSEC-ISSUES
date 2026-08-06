import 'package:avs_college_flutter/core/network/avs_api_client.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('resolveAvsApiBaseUrl', () {
    test('uses the Render HTTPS API for an unconfigured native build', () {
      expect(
        resolveAvsApiBaseUrl(isWeb: false, pageUri: Uri.parse('file:///')),
        avsProductionApiBaseUrl,
      );
    });

    test('uses the hosting origin for Flutter web', () {
      expect(
        resolveAvsApiBaseUrl(
          isWeb: true,
          pageUri: Uri.parse('https://college.example/login'),
        ),
        'https://college.example/api/v1',
      );
    });

    test('honours and normalises an explicit build override', () {
      expect(
        resolveAvsApiBaseUrl(
          isWeb: false,
          pageUri: Uri.parse('file:///'),
          configured: ' https://staging.example/api/v1/ ',
        ),
        'https://staging.example/api/v1',
      );
    });
  });
}
