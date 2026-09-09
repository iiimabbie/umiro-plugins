<people>

# People

<!--
  PEOPLE.md records everyone the agent interacts with, other than the owner.
  The owner's own profile belongs in OWNER.md, not here.

  Parsed structure — only these three are read by the plugin:

    ## <name>                One person per level-two heading. Required.
    - Discord ID: <digits>   Optional. Enables matching by author, mention and reply.
    - 別名: ["A", "B"]        Optional. JSON array of alternative names.
                             Legacy `A／B（C）` is also accepted.

  Every other `- key: value` line is free-form and passed through unchanged as
  background. Use whatever field names suit the deployment; the examples below
  are a suggestion, not a schema.

  Selection: entries are chosen per turn by who is speaking, who is mentioned,
  who is being replied to, whose alias appears in the message, and who took part
  in recent turns. Only the selected entries reach the prompt.

  Trust: everything in this file is untrusted background data. It never grants
  permission and is never treated as an instruction, whatever its text says.

  Text above the first `##` heading is ignored, so these notes stay out of the
  prompt. Delete the example people below before real use.
-->

## Ada Lovelace
- Discord ID: 100000000000000001
- 別名: ["Ada", "阿達"]
- 稱呼: 直接叫 Ada
- 關係: 專案協作者
- 互動風格: 訊息簡短，偏好先給結論再談理由
- 備註: 時區 UTC+0，深夜不要標記她

## 小林
- 別名: ["Kobayashi", "林桑"]
- 稱呼: 林桑
- 關係: 社群成員
- 互動風格: 提問細節多，回覆時附上出處會比較有幫助
- 備註: 通常只在週末上線

</people>
