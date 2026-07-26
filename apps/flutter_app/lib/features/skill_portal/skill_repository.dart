import '../../core/network/avs_api_client.dart';
import '../learning/learning_models.dart';

class SkillRepository {
  SkillRepository({AvsApiClient? client}) : _client = client ?? AvsApiClient();

  final AvsApiClient _client;

  Future<List<LearningCourse>> courses() async {
    final data = await _client.get('/skill/courses') as List<dynamic>;
    return data
        .whereType<Map<String, dynamic>>()
        .map(LearningCourse.fromJson)
        .toList();
  }

  Future<LearningProgress> progress() async {
    return LearningProgress.fromJson(
      await _client.get('/skill/progress') as Map<String, dynamic>,
    );
  }

  Future<Map<String, dynamic>> course(String id) async {
    return await _client.get('/skill/courses/$id') as Map<String, dynamic>;
  }
}
