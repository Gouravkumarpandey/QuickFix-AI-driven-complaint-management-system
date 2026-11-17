"""API contract tests. Model adapters are fixtures; no weights or provider calls."""
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import httpx
from app.main import app

class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://ai.test")
    async def asyncTearDown(self):
        await self.client.aclose()
    async def test_entry_points_and_health_do_not_load_models(self):
        from main import app as compatibility_app
        self.assertIs(compatibility_app,app)
        with patch("app.api.routes.get_model",side_effect=AssertionError("unexpected model loading")):
            for url in ["/","/health"]:
                response=await self.client.get(url)
                self.assertEqual(response.status_code,200)
                self.assertEqual(response.json()["status"],"ok")
    async def test_classification_sentiment_and_embedding_contracts(self):
        adapters={"classifier":SimpleNamespace(classify_text=lambda text,labels:{"top_label":labels[0],"top_score":0.9}),"sentiment":SimpleNamespace(analyze_sentiment=lambda text:{"label":"NEGATIVE","score":0.8}),"embedder":SimpleNamespace(get_embedding=lambda text:[0.1,0.2,0.3])}
        with patch("app.api.routes.get_model",side_effect=adapters.__getitem__):
            response=await self.client.post("/classify",json={"text":"Cannot login","labels":["login","billing"]})
            self.assertEqual(response.status_code,200);self.assertEqual(response.json()["top_label"],"login")
            self.assertEqual((await self.client.post("/sentiment",json={"text":"Very disappointed"})).json()["label"],"NEGATIVE")
            self.assertEqual((await self.client.post("/embed",json={"text":"Order delayed"})).json()["dimensions"],3)
    async def test_summary_and_reply_contracts(self):
        adapters={"summarizer":SimpleNamespace(summarize_text=lambda **kw:{"summary":"Delivery is delayed"}),"reply_gen":SimpleNamespace(generate_reply=lambda **kw:{"draft_reply":"We will investigate","needs_human_review":True})}
        with patch("app.api.routes.get_model",side_effect=adapters.__getitem__):
            self.assertEqual((await self.client.post("/summarize",json={"text":"A delayed delivery. "*10})).status_code,200)
            response=await self.client.post("/reply",json={"text":"Please check my delayed order","tone":"professional"})
            self.assertTrue(response.json()["needs_human_review"])
    async def test_invalid_inputs_never_reach_inference(self):
        with patch("app.api.routes.get_model",side_effect=AssertionError("invalid request reached inference")):
            for endpoint in ["classify","sentiment","embed","summarize","reply"]:
                for text in ["", "   ", "x"*10001]:
                    self.assertEqual((await self.client.post("/"+endpoint,json={"text":text})).status_code,422)
            self.assertEqual((await self.client.post("/classify",json={"text":"Hello","labels":[]})).status_code,422)
            self.assertEqual((await self.client.post("/reply",json={"text":"Hello","tone":"unknown"})).status_code,422)
            self.assertEqual((await self.client.post("/summarize",json={"text":"Example text"*10,"min_length":150,"max_length":50})).status_code,400)
    async def test_model_failure_is_explicit_without_exposing_internal_details(self):
        with patch("app.api.routes.get_model",side_effect=RuntimeError("private model path and configuration")):
            for endpoint in ["classify","sentiment","embed","summarize","reply"]:
                response=await self.client.post("/"+endpoint,json={"text":"Please help with a delayed order. "*3})
                self.assertEqual(response.status_code,503)
                self.assertNotIn("private model path",response.text)

if __name__=="__main__":
    unittest.main()
