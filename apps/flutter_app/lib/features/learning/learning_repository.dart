import '../../core/network/avs_api_client.dart';
import 'learning_models.dart';

class LearningRepository {
  LearningRepository({AvsApiClient? client}) : _client = client ?? AvsApiClient();

  final AvsApiClient _client;

  Future<Map<String, dynamic>> health() async {
    return await _client.get('/learn/health') as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> dashboard() async {
    return await _client.get('/learn/dashboard') as Map<String, dynamic>;
  }

  Future<List<LearningSubject>> subjects() async {
    final data = await _client.get('/learn/subjects') as List<dynamic>;
    return data.whereType<Map<String, dynamic>>().map(LearningSubject.fromJson).toList();
  }

  Future<List<LearningCourse>> courses() async {
    final data = await _client.get('/learn/courses') as List<dynamic>;
    return data.whereType<Map<String, dynamic>>().map(LearningCourse.fromJson).toList();
  }

  Future<Map<String, dynamic>> course(String courseId) async {
    return await _client.get('/learn/courses/$courseId') as Map<String, dynamic>;
  }

  Future<LearningProgress> progress({String? courseId}) async {
    final query = courseId == null ? '' : '?courseId=$courseId';
    final data = await _client.get('/learn/progress$query') as Map<String, dynamic>;
    return LearningProgress.fromJson(data);
  }

  Future<void> completeLesson({
    required String courseId,
    required String lessonId,
    bool completed = true,
  }) async {
    await _client.post('/learn/progress', {
      'courseId': courseId,
      'lessonId': lessonId,
      'completed': completed,
    });
  }
}
