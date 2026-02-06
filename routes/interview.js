const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const multer = require('multer');
const fs = require('fs');


const InterviewSession = require('../models/InterviewSession');
const Mistake = require('../models/Mistake');
const { generateContent } = require('../utils/aiHelper');
const { checkQuota, incrementUsage } = require('../middleware/quota');

const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB Limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
            return cb(new Error('Only PDF files allowed'));
        }
        cb(null, true);
    }
});

// --- Helper: PDF Extraction (Bypassing pdf-parse) ---
async function extractText(buffer) {
    try {
        // Dynamic import for ESM module in CJS
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

        // Convert buffer to Uint8Array
        const uint8Array = new Uint8Array(buffer);
        const loadingTask = getDocument({ data: uint8Array, verbosity: 0 });
        const doc = await loadingTask.promise;

        let fullText = '';
        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }
        return fullText.trim();
    } catch (error) {
        console.error('PDF Extraction Error:', error);
        return ''; // Fail gracefully
    }
}

// --- Session Management ---

// 1. Start New Session (Optional Resume)
router.post('/start', auth, upload.single('resume'), async (req, res) => {
    try {
        let resumeText = '';
        if (req.file) {
            const dataBuffer = await fs.promises.readFile(req.file.path);
            resumeText = await extractText(dataBuffer);
            await fs.promises.unlink(req.file.path); // Cleanup
        }

        const session = new InterviewSession({
            user: req.user.id,
            resumeContext: resumeText,
            manualContext: req.body.manualContext || '',
            interviewType: req.body.interviewType || 'general',
            messages: []
        });
        await session.save();
        res.json(session);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// 2. Get User History
router.get('/history', auth, async (req, res) => {
    try {
        const sessions = await InterviewSession.find({ user: req.user.id })
            .sort({ lastUpdated: -1 })
            .select('title lastUpdated createdAt');
        res.json(sessions);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// 3. Delete Session
router.delete('/session/:id', auth, async (req, res) => {
    try {
        const session = await InterviewSession.findById(req.params.id);
        if (!session) return res.status(404).json({ msg: 'Session not found' });
        if (session.user.toString() !== req.user.id) return res.status(401).json({ msg: 'Not authorized' });

        await InterviewSession.deleteOne({ _id: req.params.id });
        res.json({ msg: 'Session removed' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// 4. Get Specific Session
router.get('/session/:id', auth, async (req, res) => {
    try {
        const session = await InterviewSession.findById(req.params.id);
        if (!session) return res.status(404).json({ msg: 'Session not found' });
        if (session.user.toString() !== req.user.id) return res.status(401).json({ msg: 'Not authorized' });
        res.json(session);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// --- AI Interactions (Updated with Context) ---

// Get a random interview question
router.post('/question', auth, checkQuota, async (req, res) => {
    try {
        const { type, sessionId, length } = req.body; // length: 'short', 'medium', 'long'

        let context = '';
        let session = null; // Fix scope issue

        if (sessionId) {
            session = await InterviewSession.findById(sessionId);
            if (session && session.resumeContext) {
                context = `Candidate Resume Context: "${session.resumeContext.substring(0, 1000)}..."`;
            }
        }

        // CURATED QUESTION BANK
        const FAQ = {
            intro: [
                "Tell me about yourself.",
                "What is your background?",
                "Can you introduce yourself?",
                "What should I know about you?",
                "Describe your journey so far."
            ],
            technical: [
                "Which backend or core technologies are you familiar with?",
                "Can you explain the difference between SQL and PostgreSQL?",
                "Which SQL concepts are you confident in?",
                "How do you usually debug issues in your code?",
                "Which web technologies are you most confident in?",
                "Can you explain the projects you have worked on?",
                "Describe one project in detail.",
                "Which tech stack are you most comfortable with?"
            ],
            behavioral: [
                "How do you handle conflicts?",
                "Describe a time you showed leadership.",
                "How do you take feedback?",
                "Tell me about a challenge you overcame.",
                "How do you work in teams?",
                "What did you learn from a past failure?",
                "How do you handle pressure?",
                "Describe your work style."
            ],
            scenario: [
                "What would you do if you are assigned a task you don't know how to complete?",
                "How would you respond if a project fails in production?",
                "What if a client demands an unrealistic deadline?",
                "How would you handle receiving a better offer after joining us?",
                "What would you do if your senior is being unfair?"
            ],
            hr: [
                "Why do you want this job?",
                "Why our company?",
                "Where do you see yourself in 5 years?",
                "What are your strengths?",
                "What are your weaknesses?",
                "Why should we hire you?",
                "What motivates you?",
                "What is your expected salary?",
                "When can you start?",
                "Do you have any questions for us?"
            ],
            closing: [
                "Do you have any questions for us?",
                "Is there anything you would like to ask or clarify?",
                "Would you like to know more about the role or team?"
            ]
        };

        // 1. Determine Category based on Phase AND Interview Type
        const phase = (session && session.interviewPhase) ? session.interviewPhase : 'intro';
        const iType = (session && session.interviewType) ? session.interviewType : 'general';

        // Multi-category support for HR and Hybrid
        let availableCategories = [phase];

        if (iType === 'hr' && !['intro', 'closing'].includes(phase)) {
            // HR type: Can pull from hr, behavioral, scenario
            availableCategories = ['hr', 'behavioral', 'scenario'];
        } else if (iType === 'hybrid' && !['intro', 'closing'].includes(phase)) {
            // Hybrid: Can pull from ALL categories
            availableCategories = ['technical', 'hr', 'behavioral', 'scenario'];
        }

        // Select random category from available
        const selectedCategory = availableCategories[Math.floor(Math.random() * availableCategories.length)];
        const categoryQuestions = FAQ[selectedCategory] || FAQ[phase] || FAQ['intro'];

        // 2. Select Random Base Question
        const baseQuestion = categoryQuestions[Math.floor(Math.random() * categoryQuestions.length)];

        // 3. AI Rephrasing Prompt
        const lengthPrompt = length === 'short' ? 'Keep it concise.' : '';
        const difficulty = (session && session.difficulty) ? session.difficulty : 'medium';

        let prompt;

        // RESUME-DRIVEN PROMPT (If resume exists and phase allows)
        if (context && (phase === 'intro' || phase === 'technical' || iType === 'hybrid')) {
            prompt = `You are a professional Technical Interviewer.
             Candidate Level: ${difficulty}
             Interview Phase: ${phase}
             Interview Type: ${iType}
             
             RESUME CONTEXT:
             ${context}
             
             Task: Generate a UNIQUE, SPECIFIC question based on the candidate's resume above.
             - If Intro: Ask about a specific project or role summary.
             - If Technical: Pick a specific skill or tool mentioned in the resume and ask a conceptual question about it.
             - Do NOT ask generic questions like "Tell me about yourself". Be specific: "Tell me about your time at [Company]..." or "How did you use [Skill] in [Project]?"
             - IMPORTANT: Use SIMPLE, BASIC vocabulary. Avoid complex or advanced words. Keep the language clear and easy to understand.
             
             ${lengthPrompt}
             Return ONLY the question string.`;
        } else {
            // Standard Phase-Based Rephrasing
            prompt = `You are a professional Interviewer.
             Candidate Level: ${difficulty}
             Interview Phase: ${phase}
             Interview Type: ${iType}
             
             Base Question: "${baseQuestion}"
             
             Task: Rephrase this question naturally to sound like a human interviewer. 
             - Keep the core meaning relevant to the question category.
             - Use SIMPLE, BASIC vocabulary. Avoid complex or fancy words. Keep it clear and easy to understand.
             - ${lengthPrompt}
             
             Return ONLY the rephrased question string.`;
        }

        const questionText = await generateContent(prompt); // plain text response
        await incrementUsage(req.user.id);

        // Save to session if exists
        if (sessionId) {
            await InterviewSession.findByIdAndUpdate(sessionId, {
                $push: { messages: { role: 'ai', content: questionText } },
                $set: { lastUpdated: Date.now() }
            });
        }

        res.json({
            question: questionText,
            interviewPhase: (session && session.interviewPhase) ? session.interviewPhase : 'intro',
            interviewerMood: (session && session.interviewerMood) ? session.interviewerMood : 'friendly'
        });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ msg: err.message });
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Evaluate answer
router.post('/evaluate', auth, checkQuota, async (req, res) => {
    const { question, answer, sessionId, length } = req.body;
    try {
        // 0. SPECIAL HANDLING FOR SKIP/DON'T KNOW RESPONSES
        // These should move on immediately without asking for elaboration
        const skipPhrases = ['next', 'skip', 'pass', 'don\'t know', 'dont know', 'no idea', 'cant answer', 'can\'t answer', 'unsure', 'move on', 'proceed', 'idk'];
        const isSkip = skipPhrases.some(phrase => answer.toLowerCase().includes(phrase));
        const wordCount = answer.trim().split(/\s+/).length;

        // If user says "don't know" or similar, immediately give neutral score and move on
        if (isSkip) {
            const session = await InterviewSession.findById(sessionId);
            if (session) {
                session.questionCount += 1;
                const iType = session.interviewType || 'general';

                // Save the skip response
                await InterviewSession.findByIdAndUpdate(sessionId, {
                    $push: { messages: { role: 'user', content: answer, evaluation: { score: 5 } } },
                    $set: { lastUpdated: Date.now(), questionCount: session.questionCount },
                });

                // Generate a simple next question based on interview type
                let nextQuestion = "Let's move on. Tell me about your strengths.";
                if (iType === 'hr' || session.interviewPhase === 'hr') {
                    const hrQuestions = [
                        "What motivates you at work?",
                        "Why do you want this job?",
                        "Where do you see yourself in 5 years?",
                        "What are your salary expectations?",
                        "When can you start?"
                    ];
                    nextQuestion = hrQuestions[Math.floor(Math.random() * hrQuestions.length)];
                } else if (iType === 'behavioral' || session.interviewPhase === 'behavioral') {
                    const behavioralQuestions = [
                        "How do you handle pressure?",
                        "Tell me about a time you worked in a team.",
                        "How do you take feedback?",
                        "Describe your work style."
                    ];
                    nextQuestion = behavioralQuestions[Math.floor(Math.random() * behavioralQuestions.length)];
                }

                return res.json({
                    score: 5,
                    feedback: "No worries. Let's try a different question.",
                    betterAnswer: "",
                    nextQuestion: nextQuestion,
                    mistakes: []
                });
            }
        }

        // 1. VAGUE ANSWER CHECK (for very short answers that aren't skips)
        if (wordCount < 15) {
            // Save to session even if "fake" evaluation
            if (sessionId) {
                await InterviewSession.findByIdAndUpdate(sessionId, {
                    $push: { messages: { role: 'user', content: answer, evaluation: { score: 3 } } }, // dummy eval
                    $set: { lastUpdated: Date.now() },
                    $inc: { questionCount: 1 }
                });
            }
            return res.json({
                score: 3,
                feedback: "Your answer is too short. Please explain in more detail.",
                betterAnswer: "",
                nextQuestion: "Can you elaborate on that with a specific example?",
                mistakes: []
            });
        }

        // Fetch session for context
        const session = await InterviewSession.findById(sessionId);

        // AUTO PHASE TRANSITION LOGIC
        session.questionCount += 1;
        const iType = session.interviewType || 'general';

        if (session.questionCount >= 9) {
            session.interviewPhase = 'closing';
        } else if (session.questionCount >= 6) {
            // Late Game: Stay in main phase
            if (iType === 'technical') session.interviewPhase = 'technical';
            else if (iType === 'hr') session.interviewPhase = 'hr'; // HR stays in 'hr' but pulls from hr+behavioral+scenario
            else if (iType === 'behavioral') session.interviewPhase = 'behavioral';
            else if (iType === 'hybrid') session.interviewPhase = 'technical'; // Hybrid stays flexible
            else session.interviewPhase = 'behavioral'; // General: move to behavioral
        } else if (session.questionCount >= 2 && session.interviewPhase === 'intro') {
            // Early Game: Move to main phase based on interview type
            if (iType === 'hr') session.interviewPhase = 'hr'; // HR → pulls from hr+behavioral+scenario
            else if (iType === 'behavioral') session.interviewPhase = 'behavioral';
            else if (iType === 'technical') session.interviewPhase = 'technical';
            else if (iType === 'hybrid') session.interviewPhase = 'technical'; // Hybrid → pulls from all
            else session.interviewPhase = 'technical'; // General default
        }
        // Save these updates later or now? We save at the end, so just updating object is enough for prompt use below.

        const currentPhase = (session && session.interviewPhase) ? session.interviewPhase : 'intro';
        const difficulty = (session && session.difficulty) ? session.difficulty : 'medium';
        const currentMood = (session && session.interviewerMood) ? session.interviewerMood : 'friendly';

        const lengthPrompt = length === 'short' ? 'Keep your feedback and better answer concise.' : '';

        // 1. Confidence Check
        const fillerEx = /um|uh|maybe|i think|probably/gi;
        const fillerCount = (answer.match(fillerEx) || []).length;
        const confidenceNote = fillerCount > 2
            ? `OBSERVATION: The candidate used filler words ${fillerCount} times (um, uh, maybe). You MUST point this out and tell them to sound more confident.`
            : "";

        // PHASE-SPECIFIC CONSTRAINTS FOR NEXT QUESTION
        // iType is already declared above
        let phaseConstraint = '';

        if (iType === 'hr') {
            // HR interview type: STRICT - absolutely NO technical content
            phaseConstraint = `CRITICAL RULE - THIS IS AN HR INTERVIEW. You are ABSOLUTELY FORBIDDEN from asking about:
            - Code, programming, frameworks, libraries, APIs
            - Projects (even if mentioned by candidate)
            - Technical skills, debugging, architecture
            - Education details (BCA, degree specifics, coursework)
            
            You MUST ONLY ask HR questions:
            - Why do you want this job?
            - What are your strengths/weaknesses?
            - Where do you see yourself in 5 years?
            - What motivates you?
            - Why our company?
            - Salary expectations?
            - When can you start?
            - How do you handle work-life balance?
            
            You may also ask Behavioral or Scenario questions (teamwork, leadership, conflict, hypothetical situations).
            
            VIOLATION OF THIS RULE = IMMEDIATE FAILURE. DO NOT ask about projects, education, or technical topics.`;
        } else if (iType === 'hybrid') {
            // Hybrid: Can ask ANY type of question
            phaseConstraint = `This is a Hybrid interview. Your nextQuestion can be from ANY category: Technical, HR, Behavioral, or Scenario. Mix it up based on the conversation flow.`;
        } else if (currentPhase === 'behavioral') {
            phaseConstraint = `CRITICAL: This is a Behavioral interview. Your nextQuestion MUST be behavioral: teamwork, conflict resolution, leadership, work style, handling pressure. DO NOT ask technical questions.`;
        } else if (currentPhase === 'technical') {
            phaseConstraint = `This is a Technical interview. Your nextQuestion should focus on technical skills, projects, technologies, debugging, architecture.`;
        } else if (currentPhase === 'intro') {
            phaseConstraint = `This is the Introduction phase. Keep nextQuestion general and introductory.`;
        }

        const prompt = `You are an expert interviewer.
        Interview Phase: ${currentPhase}
        Interview Type: ${iType}
        Candidate Level: ${difficulty}
        Interviewer Mood: ${currentMood}
        
        Question: "${question}"
        Candidate Answer: "${answer}"
        ${lengthPrompt}
        ${confidenceNote}

        TONE RULES:
        - friendly: Encouraging, conversational, uses "Great point!" or "I see."
        - neutral: Professional, balanced, objective.
        - strict: Short, direct, challenging. "Why did you do that?", "That lacks detail."
        
        ${phaseConstraint}
        
        Evaluate the answer. Provide:
        1. A score out of 10.
        2. Feedback on grammar and tone.
        3. A "Better Answer" example.
        4. A "nextQuestion".

        DYNAMIC NEXT QUESTION LOGIC (Must Follow):
        - Score < 5 (Weak): The candidate gave a weak or wrong answer. You MUST ask the SAME question again but rephrased simply.
        - Score 5-7 (Average): Answer is okay. Next question should be standard relative to the current phase.
        - Score > 8 (Strong): Great answer. Next question MUST be a deeper, more challenging follow-up WITHIN THE SAME PHASE TYPE.

        Return STRICT JSON format (no markdown code blocks, no newlines in strings):
        {
            "score": 8,
            "feedback": "...",
            "betterAnswer": "...",
            "nextQuestion": "...",
            "mistakes": [
                { "wrong": "...", "right": "...", "rule": "..." }
            ]
        }`;

        const responseText = await generateContent(prompt, true);
        await incrementUsage(req.user.id);

        // Helper to extract JSON from text
        const extractJSON = (text) => {
            const match = text.match(/\{[\s\S]*\}/);
            return match ? match[0] : text;
        };

        let evaluation;
        try {
            const jsonText = extractJSON(responseText);
            evaluation = JSON.parse(jsonText);
        } catch (e) {
            console.error("AI JSON Parse Failed", responseText);
            return res.status(500).json({ msg: 'AI response parsing failed' });
        }

        // UPDATE MOOD BASED ON SCORE
        if (evaluation.score < 5) {
            session.interviewerMood = 'strict';
        } else if (evaluation.score >= 8) {
            session.interviewerMood = 'friendly';
        } else {
            session.interviewerMood = 'neutral';
        }

        // ... (save mistakes and session) ...


        // --- Save Mistakes to DB ---
        if (evaluation.mistakes && Array.isArray(evaluation.mistakes)) {
            for (const m of evaluation.mistakes) {
                // Validate mistake object structure from AI
                if (!m.wrong || !m.right) continue;

                // Upsert mistake
                await Mistake.findOneAndUpdate(
                    {
                        userId: req.user.id,
                        wrongPhrase: m.wrong
                    },
                    {
                        $set: {
                            correctPhrase: m.right,
                            rule: m.rule || 'General Grammar Rule', // Fallback
                            lastSeen: Date.now()
                        },
                        $inc: { count: 1 }
                    },
                    { upsert: true, new: true }
                );
            }
        }

        // Save to session if exists
        if (sessionId) {
            const newMessages = [
                {
                    role: 'user',
                    content: answer,
                    evaluation: evaluation
                }
            ];

            if (evaluation.nextQuestion) {
                newMessages.push({
                    role: 'ai',
                    content: evaluation.nextQuestion
                });
            }

            await InterviewSession.findByIdAndUpdate(sessionId, {
                $push: {
                    messages: {
                        $each: newMessages
                    }
                },
                $set: { lastUpdated: Date.now() }
            });

            // Save updated mood
            await session.save();
        }

        res.json({
            ...evaluation,
            interviewPhase: session.interviewPhase,
            interviewerMood: session.interviewerMood
        });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ msg: err.message });
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// 4. End Interview & Get Hiring Decision
router.post('/end', auth, checkQuota, async (req, res) => {
    try {
        const { sessionId } = req.body;
        const session = await InterviewSession.findById(sessionId);
        if (!session) return res.status(404).json({ msg: 'Session not found' });
        if (session.user.toString() !== req.user.id) return res.status(401).json({ msg: 'Not authorized' });

        // Compile context from messages
        const conversation = session.messages.map(m =>
            `${m.role === 'ai' ? 'Interviewer' : 'Candidate'}: "${m.content}"`
        ).join('\n');

        const prompt = `You are a Senior Hiring Manager.
        Review this entire interview transcript for a "${session.difficulty || 'medium'}" level role.
        
        TRANSCRIPT:
        ${conversation}
        
        Task: Provide a final hiring assessment as if you are a real human manager talking to a colleague.
        
        Return STRICT JSON format:
        {
            "hiringDecision": "Yes" | "Maybe" | "No",
            "decisionReason": "Honest, human-like explanation. Start with 'If this were a real interview...'",
            "strengths": ["List 3 key strengths."],
            "weakAreas": ["List 3 specific weak areas."],
            "improvementPlan": "Specific, actionable advice.",
            "overallScore": (1-100)
        }`;

        const responseText = await generateContent(prompt, true);
        await incrementUsage(req.user.id);

        let report = { hiringDecision: "Maybe", overallScore: 50 };
        try {
            const match = responseText.match(/\{[\s\S]*\}/);
            if (match) report = JSON.parse(match[0]);
        } catch (e) { console.error("JSON Parse Error", e); }

        // Save Report
        session.finalFeedback = report;
        await session.save();

        res.json(report);

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
