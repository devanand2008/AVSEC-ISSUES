import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

class AvsApiClient {
  AvsApiClient({
    http.Client? httpClient,
    FlutterSecureStorage? storage,
    String? baseUrl,
  })  : _httpClient = httpClient ?? http.Client(),
        _storage = storage ?? const FlutterSecureStorage(),
        baseUrl = baseUrl ?? _defaultBaseUrl();

  final http.Client _httpClient;
  final FlutterSecureStorage _storage;
  final String baseUrl;
  static String? _memoryAccessToken;
  static String? _memoryRefreshToken;
  static bool _secureStorageUnavailable = false;

  static String _defaultBaseUrl() {
    const configured = String.fromEnvironment('AVS_API_BASE_URL');
    if (configured.isNotEmpty) return configured;
    if (kIsWeb) {
      final scheme = Uri.base.scheme == 'https' ? 'https' : 'http';
      return '$scheme://${Uri.base.host}:4000/api/v1';
    }
    return 'http://localhost:4000/api/v1';
  }

  Future<Map<String, String>> _headers({bool authenticated = true}) async {
    final token = authenticated ? await _readToken('avs_access_token') : null;
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'x-avs-client': 'flutter',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    };
  }

  Future<dynamic> get(String path) async {
    return _sendWithRefresh(
      () async => _httpClient.get(
        Uri.parse('$baseUrl$path'),
        headers: await _headers(),
      ),
    );
  }

  Future<AvsDownload> getBytes(String path) async {
    final response = await _responseWithRefresh(
      () async => _httpClient.get(
        Uri.parse('$baseUrl$path'),
        headers: await _headers(),
      ),
    );
    return AvsDownload(
      bytes: response.bodyBytes,
      contentType: response.headers['content-type'],
      fileName: _fileName(response.headers['content-disposition']),
    );
  }

  Future<AvsDownload> getExternalBytes(String url) async {
    final response = await _httpClient.get(Uri.parse(url));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AvsApiException(
        response.statusCode,
        'The private file could not be downloaded.',
      );
    }
    return AvsDownload(
      bytes: response.bodyBytes,
      contentType: response.headers['content-type'],
      fileName: _fileName(response.headers['content-disposition']),
    );
  }

  Future<dynamic> post(String path, Map<String, dynamic> body) async {
    return _sendWithRefresh(
      () async => _httpClient.post(
        Uri.parse('$baseUrl$path'),
        headers: await _headers(),
        body: jsonEncode(body),
      ),
    );
  }

  Future<dynamic> patch(String path, Map<String, dynamic> body) async {
    return _sendWithRefresh(
      () async => _httpClient.patch(
        Uri.parse('$baseUrl$path'),
        headers: await _headers(),
        body: jsonEncode(body),
      ),
    );
  }

  Future<dynamic> delete(String path, [Map<String, dynamic>? body]) async {
    return _sendWithRefresh(
      () async => _httpClient.delete(
        Uri.parse('$baseUrl$path'),
        headers: await _headers(),
        body: body == null ? null : jsonEncode(body),
      ),
    );
  }

  Future<AvsDownload> postBytes(
    String path,
    Map<String, dynamic> body,
  ) async {
    final response = await _responseWithRefresh(
      () async => _httpClient.post(
        Uri.parse('$baseUrl$path'),
        headers: await _headers(),
        body: jsonEncode(body),
      ),
    );
    return AvsDownload(
      bytes: response.bodyBytes,
      contentType: response.headers['content-type'],
      fileName: _fileName(response.headers['content-disposition']),
    );
  }

  Future<void> putSignedBytes({
    required String url,
    required List<int> bytes,
    required String contentType,
    void Function(double progress)? onProgress,
  }) async {
    final request = http.StreamedRequest('PUT', Uri.parse(url))
      ..headers['content-type'] = contentType
      ..contentLength = bytes.length;
    final responseFuture = _httpClient.send(request);
    const chunkSize = 64 * 1024;
    var sent = 0;
    while (sent < bytes.length) {
      final end = (sent + chunkSize).clamp(0, bytes.length);
      request.sink.add(bytes.sublist(sent, end));
      sent = end;
      onProgress?.call(bytes.isEmpty ? 1 : sent / bytes.length);
      await Future<void>.delayed(Duration.zero);
    }
    await request.sink.close();
    final response = await http.Response.fromStream(await responseFuture);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AvsApiException(
        response.statusCode,
        'Private attachment storage rejected the upload.',
      );
    }
  }

  Future<String?> accessToken() => _readToken('avs_access_token');

  Future<dynamic> postFile(
    String path, {
    required Map<String, String> fields,
    required String fileName,
    required List<int> bytes,
  }) async {
    Future<http.Response> send() async {
      final request = http.MultipartRequest('POST', Uri.parse('$baseUrl$path'));
      final headers = await _headers();
      headers.remove('Content-Type');
      request.headers.addAll(headers);
      request.fields.addAll(fields);
      request.files.add(
        http.MultipartFile.fromBytes('file', bytes, filename: fileName),
      );
      return http.Response.fromStream(await _httpClient.send(request));
    }

    return _sendWithRefresh(send);
  }

  Future<Map<String, dynamic>> login({
    required String identifier,
    required String password,
    String? collegeCode,
  }) async {
    final response = await _httpClient.post(
      Uri.parse('$baseUrl/auth/login'),
      headers: await _headers(authenticated: false),
      body: jsonEncode({
        'identifier': identifier,
        'password': password,
        if (collegeCode != null && collegeCode.trim().isNotEmpty)
          'collegeCode': collegeCode.trim(),
      }),
    );
    final payload = _decode(response) as Map<String, dynamic>;
    await _storeTokens(payload['tokens']);
    return payload;
  }

  Future<void> logout() async {
    final refreshToken = await _readToken('avs_refresh_token');
    try {
      await _httpClient.post(
        Uri.parse('$baseUrl/auth/logout'),
        headers: await _headers(),
        body: jsonEncode({'refreshToken': refreshToken}),
      );
    } finally {
      await clearSession();
    }
  }

  Future<void> clearSession() async {
    _memoryAccessToken = null;
    _memoryRefreshToken = null;
    if (_secureStorageUnavailable) return;
    try {
      await _storage.delete(key: 'avs_access_token');
      await _storage.delete(key: 'avs_refresh_token');
    } catch (_) {
      _secureStorageUnavailable = true;
    }
  }

  Future<dynamic> _sendWithRefresh(
    Future<http.Response> Function() request,
  ) async {
    var response = await request();
    if (response.statusCode == 401 && await _refresh()) {
      response = await request();
    }
    final payload = _decode(response);
    if (payload is Map<String, dynamic> && payload['tokens'] != null) {
      await _storeTokens(payload['tokens']);
    }
    return payload;
  }

  Future<http.Response> _responseWithRefresh(
    Future<http.Response> Function() request,
  ) async {
    var response = await request();
    if (response.statusCode == 401 && await _refresh()) {
      response = await request();
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      _decode(response);
    }
    return response;
  }

  Future<bool> _refresh() async {
    final refreshToken = await _readToken('avs_refresh_token');
    if (refreshToken == null || refreshToken.isEmpty) return false;
    final response = await _httpClient.post(
      Uri.parse('$baseUrl/auth/refresh'),
      headers: await _headers(authenticated: false),
      body: jsonEncode({'refreshToken': refreshToken}),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      await clearSession();
      return false;
    }
    final payload = _decode(response) as Map<String, dynamic>;
    await _storeTokens(payload['tokens']);
    return true;
  }

  Future<void> _storeTokens(dynamic value) async {
    if (value is! Map<String, dynamic>) {
      throw AvsApiException(
          500, 'The authentication response did not include mobile tokens.');
    }
    final accessToken = value['accessToken'] as String?;
    final refreshToken = value['refreshToken'] as String?;
    if (accessToken == null || refreshToken == null) {
      throw AvsApiException(500, 'The authentication response was incomplete.');
    }
    _memoryAccessToken = accessToken;
    _memoryRefreshToken = refreshToken;
    if (_secureStorageUnavailable) return;
    try {
      await _storage.write(key: 'avs_access_token', value: accessToken);
      await _storage.write(key: 'avs_refresh_token', value: refreshToken);
    } catch (_) {
      _secureStorageUnavailable = true;
    }
  }

  Future<String?> _readToken(String key) async {
    final memoryValue =
        key == 'avs_access_token' ? _memoryAccessToken : _memoryRefreshToken;
    if (_secureStorageUnavailable) return memoryValue;
    try {
      return await _storage.read(key: key) ?? memoryValue;
    } catch (_) {
      _secureStorageUnavailable = true;
      return memoryValue;
    }
  }

  dynamic _decode(http.Response response) {
    final payload = response.body.isEmpty ? null : jsonDecode(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final rawMessage = payload is Map<String, dynamic>
          ? payload['message'] ?? payload['error']
          : response.reasonPhrase;
      final message = rawMessage is List ? rawMessage.join(' ') : rawMessage;
      throw AvsApiException(response.statusCode, '$message');
    }
    return payload;
  }

  String? _fileName(String? disposition) {
    if (disposition == null) return null;
    final match = RegExp('filename="?([^";]+)"?', caseSensitive: false)
        .firstMatch(disposition);
    return match?.group(1);
  }
}

class AvsDownload {
  const AvsDownload({
    required this.bytes,
    this.fileName,
    this.contentType,
  });

  final Uint8List bytes;
  final String? fileName;
  final String? contentType;
}

class AvsApiException implements Exception {
  AvsApiException(this.statusCode, this.message);

  final int statusCode;
  final String message;

  @override
  String toString() => 'AVS API $statusCode: $message';
}
